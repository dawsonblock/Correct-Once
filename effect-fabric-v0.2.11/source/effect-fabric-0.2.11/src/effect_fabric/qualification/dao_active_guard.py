"""Pre-commit guard for the direct durable-agent-outbox compatibility path.

The upstream donor scheduler/reducer proposes donor-shaped action and audit records.  Before those
records reach the Effect Fabric SQLite compatibility store, this module checks the transition as an
Effect Fabric invariant boundary.  Unlike the v0.2.4 post-operation shadow, this guard runs before
persistence and can veto a bad write.

It intentionally validates facts that are independent of the donor implementation: stable action
identity, monotonic revisions/fencing epochs, an append-only legal transition chain, durable intent
before crossed states, and the rule that a crossed effect can never be rewritten as a pre-effect
withdrawal/supersession.
"""
from __future__ import annotations

from typing import Any

from .dao_engine_shadow import CROSSED, LEGAL_TRANSITIONS, TERMINAL


class DaoActiveGuardError(RuntimeError):
    """Raised when a proposed donor-shaped commit violates Effect Fabric invariants."""


_ATTEMPTED_STATES = {
    "ATTEMPTING",
    "IN_DOUBT",
    "EXECUTED",
    "ACKED",
    "EXECUTED_THEN_WITHDRAWN",
    "EXECUTED_THEN_SUPERSEDED",
}
_PRE_EFFECT_TERMINAL = {"REVOKED_BEFORE_EXECUTION", "SUPERSEDED_BEFORE_EXECUTION"}


def _subject(action: dict[str, Any]) -> str:
    intent = action.get("intent") or {}
    subject = intent.get("subject")
    if not isinstance(subject, str) or not subject:
        raise DaoActiveGuardError("intent.subject must be a non-empty string")
    return subject


def _validate_event_chain(
    before_status: str | None,
    after_status: str,
    action_id: str,
    events: list[dict[str, Any]],
) -> None:
    current = before_status
    previous_seq: int | None = None
    for row in events:
        if str(row.get("actionId")) != action_id:
            raise DaoActiveGuardError("audit event actionId does not match committed action")
        seq = int(row["seq"])
        if previous_seq is not None and seq <= previous_seq:
            raise DaoActiveGuardError("audit sequence inside commit is not strictly increasing")
        previous_seq = seq
        event_from = row.get("from")
        event_to = row.get("to")
        if event_from != current:
            raise DaoActiveGuardError(
                f"audit transition starts at {event_from!r}, expected {current!r}"
            )
        if event_to is None:
            raise DaoActiveGuardError("audit transition has no target state")
        if current is None:
            if event_to != "READY":
                raise DaoActiveGuardError(f"creation must enter READY, got {event_to}")
        elif event_to != current:
            legal = LEGAL_TRANSITIONS.get(current, set())
            if event_to not in legal:
                raise DaoActiveGuardError(f"illegal transition {current} -> {event_to}")
        current = str(event_to)

    if events:
        if current != after_status:
            raise DaoActiveGuardError(
                f"audit chain ended in {current}, but committed action is {after_status}"
            )
    elif before_status is not None and before_status != after_status:
        raise DaoActiveGuardError("status changed without an audit event")


def validate_commit(
    *,
    before: dict[str, Any] | None,
    expected_revision: int | None,
    action: dict[str, Any],
    events: list[dict[str, Any]],
) -> dict[str, Any]:
    """Validate a single proposed compare-and-swap commit before it reaches persistence."""
    action_id = str(action.get("id") or "")
    if not action_id:
        raise DaoActiveGuardError("action.id must be a non-empty string")
    status = str(action.get("status") or "")
    if status not in LEGAL_TRANSITIONS:
        raise DaoActiveGuardError(f"unknown action status: {status}")
    revision = int(action["revision"])
    epoch = int(action["epoch"])
    idem = action.get("idempotencyKey")
    if not isinstance(idem, str) or not idem:
        raise DaoActiveGuardError("idempotencyKey must be a non-empty string")
    subject = _subject(action)

    before_status: str | None = None
    if before is None:
        if expected_revision is not None:
            raise DaoActiveGuardError("create commit supplied a non-null expected revision")
        if revision < 1:
            raise DaoActiveGuardError("created action must start at revision >= 1")
    else:
        before_status = str(before["status"])
        before_revision = int(before["revision"])
        before_epoch = int(before["epoch"])
        if expected_revision != before_revision:
            raise DaoActiveGuardError(
                f"expected revision {expected_revision!r} does not match observed {before_revision}"
            )
        if revision <= before_revision:
            raise DaoActiveGuardError("committed revision must advance")
        if epoch < before_epoch:
            raise DaoActiveGuardError("fencing epoch regressed")
        if action_id != str(before["id"]):
            raise DaoActiveGuardError("action id changed")
        if idem != before.get("idempotencyKey"):
            raise DaoActiveGuardError("idempotency key changed")
        if subject != _subject(before) or int(action["seq"]) != int(before["seq"]):
            raise DaoActiveGuardError("stable action identity changed")
        if before_status in TERMINAL:
            raise DaoActiveGuardError(f"terminal action {action_id} cannot be committed again")
        if before_status in CROSSED and status in _PRE_EFFECT_TERMINAL:
            raise DaoActiveGuardError("crossed effect rewritten as a pre-effect terminal state")

    _validate_event_chain(before_status, status, action_id, events)

    attempted = bool(action.get("attempted", False))
    attempts = int(action.get("attempts", 0))
    if status in _ATTEMPTED_STATES and not attempted:
        raise DaoActiveGuardError(f"{status} requires attempted=true")
    if status in CROSSED and attempts < 1:
        raise DaoActiveGuardError(f"{status} requires at least one recorded attempt")

    return {
        "accepted": True,
        "action_id": action_id,
        "status": status,
        "revision": revision,
        "epoch": epoch,
        "events": len(events),
    }
