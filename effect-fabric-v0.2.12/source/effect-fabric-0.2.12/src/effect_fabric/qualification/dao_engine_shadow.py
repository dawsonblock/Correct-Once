"""Effect Fabric-owned execution-state shadow for the upstream DAO engine interface.

The official durable-agent-outbox suite drives a structural OutboxEngine wrapper in TypeScript.
After every public engine operation, the wrapper projects the durable action/audit state into this
module.  The shadow independently checks the invariants Effect Fabric cares about: immutable action
identity, monotonic revisions/fencing epochs, legal external-effect transitions, and honest mapping
of ambiguous/crossed/withdrawn states.

This is deliberately *not* a replacement for :class:`effect_fabric.engine.EffectEngine`.  It is a
qualification adapter that closes the structural OutboxEngine interface while keeping the active
Effect Fabric runtime unchanged until the remaining promotion gates pass.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from effect_fabric.reducer import ReducerExecution, RequestDisposition


class DaoEngineShadowError(RuntimeError):
    """Raised when an observed upstream-engine state violates Effect Fabric invariants."""


LEGAL_TRANSITIONS: dict[str, set[str]] = {
    "READY": {"LEASED", "REVOKED_BEFORE_EXECUTION", "SUPERSEDED_BEFORE_EXECUTION"},
    "LEASED": {
        "LEASED",
        "READY",
        "ATTEMPTING",
        "REVOKED_BEFORE_EXECUTION",
        "SUPERSEDED_BEFORE_EXECUTION",
        "FAILED_TERMINAL",
    },
    "ATTEMPTING": {"ATTEMPTING", "EXECUTED", "IN_DOUBT", "READY", "FAILED_TERMINAL"},
    "IN_DOUBT": {"IN_DOUBT", "EXECUTED", "NOT_LANDED", "FAILED_TERMINAL"},
    "NOT_LANDED": {
        "READY",
        "REVOKED_BEFORE_EXECUTION",
        "SUPERSEDED_BEFORE_EXECUTION",
        "FAILED_TERMINAL",
    },
    "EXECUTED": {"ACKED", "EXECUTED_THEN_WITHDRAWN", "EXECUTED_THEN_SUPERSEDED"},
    "ACKED": set(),
    "EXECUTED_THEN_WITHDRAWN": set(),
    "EXECUTED_THEN_SUPERSEDED": set(),
    "REVOKED_BEFORE_EXECUTION": set(),
    "SUPERSEDED_BEFORE_EXECUTION": set(),
    "FAILED_TERMINAL": set(),
}

CROSSED = {"EXECUTED", "ACKED", "EXECUTED_THEN_WITHDRAWN", "EXECUTED_THEN_SUPERSEDED"}
TERMINAL = {
    "ACKED",
    "EXECUTED_THEN_WITHDRAWN",
    "EXECUTED_THEN_SUPERSEDED",
    "REVOKED_BEFORE_EXECUTION",
    "SUPERSEDED_BEFORE_EXECUTION",
    "FAILED_TERMINAL",
}


@dataclass(frozen=True)
class ShadowProjection:
    execution: ReducerExecution
    disposition: RequestDisposition
    crossed: bool


@dataclass
class _SeenAction:
    idempotency_key: str
    subject: str
    seq: int
    revision: int
    epoch: int
    status: str
    attempted: bool


def project_action(action: dict[str, Any]) -> ShadowProjection:
    """Project a donor action into Effect Fabric's orthogonal execution/disposition model."""
    status = str(action["status"])
    if status in {"READY", "LEASED", "NOT_LANDED"}:
        execution = ReducerExecution.PREPARED
    elif status == "ATTEMPTING":
        execution = ReducerExecution.STARTED
    elif status == "IN_DOUBT":
        execution = ReducerExecution.IN_DOUBT
    elif status in {"EXECUTED", "ACKED", "EXECUTED_THEN_WITHDRAWN", "EXECUTED_THEN_SUPERSEDED"}:
        execution = ReducerExecution.RECEIPT_RECORDED
    else:
        execution = ReducerExecution.EXECUTION_FAILED

    if status == "REVOKED_BEFORE_EXECUTION":
        disposition = RequestDisposition.WITHDRAWN_BEFORE_EFFECT
    elif status == "SUPERSEDED_BEFORE_EXECUTION":
        disposition = RequestDisposition.SUPERSEDED_BEFORE_EFFECT
    elif status == "EXECUTED_THEN_WITHDRAWN":
        disposition = RequestDisposition.EFFECT_THEN_WITHDRAWN
    elif status == "EXECUTED_THEN_SUPERSEDED":
        disposition = RequestDisposition.EFFECT_THEN_SUPERSEDED
    else:
        disposition = RequestDisposition.ACTIVE
    return ShadowProjection(execution=execution, disposition=disposition, crossed=status in CROSSED)


class DaoEngineInvariantShadow:
    """Stateful invariant checker used by the direct upstream engine-interface adapter."""

    def __init__(self) -> None:
        self._seen: dict[str, _SeenAction] = {}
        self.observations = 0
        self.max_audit_seq = 0

    def observe(self, actions: list[dict[str, Any]], audit: list[dict[str, Any]]) -> dict[str, Any]:
        audit_seq = [int(row["seq"]) for row in audit]
        if audit_seq != sorted(audit_seq) or len(set(audit_seq)) != len(audit_seq):
            raise DaoEngineShadowError("audit sequence is not strictly unique/monotonic")
        if audit_seq and audit_seq[-1] < self.max_audit_seq:
            raise DaoEngineShadowError("audit trail regressed")
        # Validate every newly observed transition from the append-only trail. This is stronger than
        # assuming one wrapper observation equals one state transition: drain() legitimately commits
        # several intermediate states before returning.
        for row in audit:
            seq = int(row["seq"])
            if seq <= self.max_audit_seq:
                continue
            from_state = row.get("from")
            to_state = row.get("to")
            if from_state is None:
                if to_state != "READY":
                    raise DaoEngineShadowError(
                        f"audit creation target must be READY, got {to_state}"
                    )
            elif to_state is not None and to_state != from_state:
                legal_targets = LEGAL_TRANSITIONS.get(from_state, set())
                if to_state not in legal_targets:
                    raise DaoEngineShadowError(
                        f"illegal audited transition {from_state} -> {to_state} at seq={seq}"
                    )
        if audit_seq:
            self.max_audit_seq = max(self.max_audit_seq, audit_seq[-1])

        projected: list[dict[str, Any]] = []
        for action in actions:
            self._observe_action(action)
            p = project_action(action)
            projected.append(
                {
                    "id": action["id"],
                    "execution": p.execution.value,
                    "disposition": p.disposition.value,
                    "crossed": p.crossed,
                }
            )
        self.observations += 1
        return {
            "observations": self.observations,
            "actions": projected,
            "max_audit_seq": self.max_audit_seq,
        }

    def _observe_action(self, action: dict[str, Any]) -> None:
        action_id = str(action["id"])
        status = str(action["status"])
        if status not in LEGAL_TRANSITIONS:
            raise DaoEngineShadowError(f"unknown action status: {status}")
        intent = action.get("intent") or {}
        subject = intent.get("subject")
        if not isinstance(subject, str):
            raise DaoEngineShadowError("intent.subject must be a string")
        key = action.get("idempotencyKey")
        if not isinstance(key, str) or not key:
            raise DaoEngineShadowError("idempotencyKey must be a non-empty string")
        revision = int(action["revision"])
        epoch = int(action["epoch"])
        seq = int(action["seq"])
        attempted = bool(action.get("attempted", False))

        crossed_or_attempted = {
            "ATTEMPTING",
            "IN_DOUBT",
            "EXECUTED",
            "ACKED",
            "EXECUTED_THEN_WITHDRAWN",
            "EXECUTED_THEN_SUPERSEDED",
        }
        if status in crossed_or_attempted and not attempted:
            raise DaoEngineShadowError(
                f"{action_id} claims {status} without attempted=true"
            )
        if status in CROSSED and int(action.get("attempts", 0)) < 1:
            raise DaoEngineShadowError(f"{action_id} crossed without a recorded attempt")

        previous = self._seen.get(action_id)
        if previous is not None:
            if key != previous.idempotency_key:
                raise DaoEngineShadowError(f"{action_id} changed idempotency key")
            if subject != previous.subject or seq != previous.seq:
                raise DaoEngineShadowError(f"{action_id} changed stable action identity")
            if revision < previous.revision:
                raise DaoEngineShadowError(f"{action_id} revision regressed")
            if epoch < previous.epoch:
                raise DaoEngineShadowError(f"{action_id} fencing epoch regressed")
            # A public engine operation such as drain() may encompass several legal transitions.
            # Those hops are validated from the audit trail in observe(); here we only require
            # monotonic durable state and immutable action identity.
            if previous.status in TERMINAL and revision != previous.revision:
                raise DaoEngineShadowError(
                    f"terminal action {action_id} mutated after {previous.status}"
                )
            pre_effect_terminal = {
                "REVOKED_BEFORE_EXECUTION",
                "SUPERSEDED_BEFORE_EXECUTION",
            }
            if previous.status in CROSSED and status in pre_effect_terminal:
                raise DaoEngineShadowError(
                    f"{action_id} falsely rewrote a crossed effect as pre-effect"
                )

        self._seen[action_id] = _SeenAction(
            idempotency_key=key,
            subject=subject,
            seq=seq,
            revision=revision,
            epoch=epoch,
            status=status,
            attempted=attempted,
        )
