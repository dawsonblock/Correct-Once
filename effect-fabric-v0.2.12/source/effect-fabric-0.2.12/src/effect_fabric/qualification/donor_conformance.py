"""Internal semantic port of the durable-agent-outbox conformance scenarios.

This module is intentionally parameterized by a reducer implementation.  The default implementation
uses Effect Fabric's pure reducer, while v0.2.5 negative controls inject one plausible defect at a
time.  This proves that the qualification suite has discriminatory power rather than merely passing
one implementation.

This remains an internal semantic port.  It is not a claim that the upstream TypeScript conformance
package executed against Effect Fabric.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from .. import reducer
from ..reducer import (
    PureEffectState,
    ReduceResult,
    ReducerExecution,
    RequestDisposition,
    SettlementOutcome,
)

SCENARIO_IDS = (
    "duplicateDelivery",
    "crashAfterIntent",
    "unknownWaitsForReceipt",
    "unknownRevokeLanded",
    "unknownRevokeNotLanded",
    "ackedCannotBecomeRevoked",
    "progressUnderInDoubt",
    "supersessionBefore",
    "supersessionAfter",
    "staleEpochNoop",
    "idempotencyKeyStability",
    "receiptReplayIsNoop",
    "inDoubtDrains",
    "expectedExecutions",
    "receiptSourceCompleteness",
    "forgedReceiptRefused",
    "receiptRedeliveryIsIdempotent",
)


@dataclass(frozen=True)
class ScenarioResult:
    scenario: str
    passed: bool
    detail: str


class ReducerOps(Protocol):
    def record_delivery(self, state: PureEffectState, delivery_id: str) -> ReduceResult: ...
    def prepare(self, state: PureEffectState) -> ReduceResult: ...
    def authorize(self, state: PureEffectState) -> ReduceResult: ...
    def start(
        self,
        state: PureEffectState,
        *,
        epoch: int,
        idempotency_key: str,
    ) -> ReduceResult: ...
    def mark_unknown(self, state: PureEffectState, *, epoch: int) -> ReduceResult: ...
    def record_receipt(
        self,
        state: PureEffectState,
        *,
        epoch: int,
        receipt_digest: str,
    ) -> ReduceResult: ...
    def request_withdrawal(self, state: PureEffectState) -> ReduceResult: ...
    def request_supersession(
        self,
        state: PureEffectState,
        *,
        superseder_action_id: str,
    ) -> ReduceResult: ...
    def apply_settlement(
        self,
        state: PureEffectState,
        *,
        outcome: SettlementOutcome,
        authenticated: bool,
        receipt_digest: str | None = None,
    ) -> ReduceResult: ...
    def acknowledge(self, state: PureEffectState) -> ReduceResult: ...


class ReferenceReducerOps:
    """Thin object adapter around the side-effect-free reducer functions."""

    def record_delivery(self, state: PureEffectState, delivery_id: str) -> ReduceResult:
        return reducer.record_delivery(state, delivery_id)

    def prepare(self, state: PureEffectState) -> ReduceResult:
        return reducer.prepare(state)

    def authorize(self, state: PureEffectState) -> ReduceResult:
        return reducer.authorize(state)

    def start(
        self,
        state: PureEffectState,
        *,
        epoch: int,
        idempotency_key: str,
    ) -> ReduceResult:
        return reducer.start(state, epoch=epoch, idempotency_key=idempotency_key)

    def mark_unknown(self, state: PureEffectState, *, epoch: int) -> ReduceResult:
        return reducer.mark_unknown(state, epoch=epoch)

    def record_receipt(
        self,
        state: PureEffectState,
        *,
        epoch: int,
        receipt_digest: str,
    ) -> ReduceResult:
        return reducer.record_receipt(state, epoch=epoch, receipt_digest=receipt_digest)

    def request_withdrawal(self, state: PureEffectState) -> ReduceResult:
        return reducer.request_withdrawal(state)

    def request_supersession(
        self,
        state: PureEffectState,
        *,
        superseder_action_id: str,
    ) -> ReduceResult:
        return reducer.request_supersession(state, superseder_action_id=superseder_action_id)

    def apply_settlement(
        self,
        state: PureEffectState,
        *,
        outcome: SettlementOutcome,
        authenticated: bool,
        receipt_digest: str | None = None,
    ) -> ReduceResult:
        return reducer.apply_settlement(
            state,
            outcome=outcome,
            authenticated=authenticated,
            receipt_digest=receipt_digest,
        )

    def acknowledge(self, state: PureEffectState) -> ReduceResult:
        return reducer.acknowledge(state)


def _prepared(
    ops: ReducerOps,
    action_id: str = "a1",
    *,
    subject: str = "subject",
    seq: int = 1,
    key: str = "key",
) -> PureEffectState:
    state = PureEffectState(
        action_id=action_id,
        subject_key=subject,
        seq=seq,
        idempotency_key=key,
    )
    state = ops.prepare(state).state
    return ops.authorize(state).state


def run_internal_scenarios(ops: ReducerOps | None = None) -> tuple[ScenarioResult, ...]:
    ops = ops or ReferenceReducerOps()
    out: list[ScenarioResult] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        out.append(ScenarioResult(name, ok, detail or ("pass" if ok else "failed")))

    # 01 duplicate delivery: envelope retries do not alter stable action identity or key.
    state = _prepared(ops)
    for delivery_id in ("d1", "d2", "d3", "d2"):
        state = ops.record_delivery(state, delivery_id).state
    check(
        "duplicateDelivery",
        len(state.deliveries) == 3
        and state.action_id == "a1"
        and state.idempotency_key == "key",
    )

    # 02 crash after external intent: STARTED -> IN_DOUBT with an attempted effect.
    state = ops.start(_prepared(ops), epoch=1, idempotency_key="key").state
    state = ops.mark_unknown(state, epoch=1).state
    check(
        "crashAfterIntent",
        state.execution is ReducerExecution.IN_DOUBT and state.attempted,
    )

    # 03 UNKNOWN waits when no authoritative settlement exists.
    before = state
    after = ops.apply_settlement(
        state,
        outcome=SettlementOutcome.INCONCLUSIVE,
        authenticated=True,
    ).state
    check(
        "unknownWaitsForReceipt",
        before.execution is ReducerExecution.IN_DOUBT and before == after,
    )

    # 04/05 withdrawal during ambiguity must preserve the later settlement truth.
    withdrawn = ops.request_withdrawal(state).state
    landed = ops.apply_settlement(
        withdrawn,
        outcome=SettlementOutcome.LANDED,
        authenticated=True,
        receipt_digest="r",
    ).state
    check(
        "unknownRevokeLanded",
        landed.disposition is RequestDisposition.EFFECT_THEN_WITHDRAWN,
    )
    withdrawn_again = ops.request_withdrawal(state).state
    missed = ops.apply_settlement(
        withdrawn_again,
        outcome=SettlementOutcome.NOT_LANDED,
        authenticated=True,
    ).state
    check(
        "unknownRevokeNotLanded",
        missed.disposition is RequestDisposition.WITHDRAWN_BEFORE_EFFECT,
    )

    # 06 acknowledged effects are terminal to withdrawal.
    acknowledged = ops.acknowledge(landed).state
    rejected = ops.request_withdrawal(acknowledged)
    check(
        "ackedCannotBecomeRevoked",
        not rejected.accepted and rejected.state == acknowledged,
    )

    # 07 reconciliation progresses while unrelated work can also execute.
    other = ops.start(
        _prepared(ops, "a2", key="k2"),
        epoch=1,
        idempotency_key="k2",
    ).state
    drained = ops.apply_settlement(
        state,
        outcome=SettlementOutcome.LANDED,
        authenticated=True,
        receipt_digest="progress",
    ).state
    check(
        "progressUnderInDoubt",
        drained.execution is ReducerExecution.RECONCILED
        and other.execution is ReducerExecution.STARTED,
    )

    # 08 supersession before execution suppresses the loser.
    loser = ops.request_supersession(
        _prepared(ops, "old"),
        superseder_action_id="new",
    ).state
    attempted = ops.start(loser, epoch=1, idempotency_key="key")
    check(
        "supersessionBefore",
        loser.disposition is RequestDisposition.SUPERSEDED_BEFORE_EFFECT
        and not attempted.accepted,
    )

    # 09 supersession during ambiguity records both the effect and later desired state.
    displaced = ops.request_supersession(state, superseder_action_id="new").state
    displaced = ops.apply_settlement(
        displaced,
        outcome=SettlementOutcome.LANDED,
        authenticated=True,
        receipt_digest="r2",
    ).state
    check(
        "supersessionAfter",
        displaced.disposition is RequestDisposition.EFFECT_THEN_SUPERSEDED
        and displaced.superseded_by == "new",
    )

    # 10 stale epoch must be rejected without mutation.
    stale = ops.mark_unknown(other, epoch=99)
    check("staleEpochNoop", not stale.accepted and stale.state == other)

    # 11 idempotency key remains intent-derived across delivery retries and fresh authorization.
    retry = _prepared(ops, "retry")
    retry = ops.record_delivery(retry, "delivery-a").state
    first = ops.start(retry, epoch=1, idempotency_key="key").state
    uncertain = ops.mark_unknown(first, epoch=1).state
    rearmed = ops.apply_settlement(
        uncertain,
        outcome=SettlementOutcome.NOT_LANDED,
        authenticated=True,
    ).state
    reauthorized = ops.authorize(rearmed).state
    second = ops.start(reauthorized, epoch=2, idempotency_key="key")
    wrong = ops.start(reauthorized, epoch=2, idempotency_key="other")
    check(
        "idempotencyKeyStability",
        second.accepted
        and second.state.execution is ReducerExecution.STARTED
        and not wrong.accepted
        and second.state.idempotency_key == "key",
    )

    # 12 receipt replay cannot mutate an already-settled action.
    settled = ops.apply_settlement(
        uncertain,
        outcome=SettlementOutcome.LANDED,
        authenticated=True,
        receipt_digest="receipt",
    ).state
    replay = ops.apply_settlement(
        settled,
        outcome=SettlementOutcome.LANDED,
        authenticated=True,
        receipt_digest="receipt",
    )
    check("receiptReplayIsNoop", not replay.accepted and replay.state == settled)

    # 13 multiple ambiguous actions can drain in opposite directions.
    x1_started = ops.start(
        _prepared(ops, "x1", key="x1"), epoch=1, idempotency_key="x1"
    ).state
    x2_started = ops.start(
        _prepared(ops, "x2", key="x2"), epoch=1, idempotency_key="x2"
    ).state
    x1 = ops.mark_unknown(x1_started, epoch=1).state
    x2 = ops.mark_unknown(x2_started, epoch=1).state
    x1 = ops.apply_settlement(
        x1,
        outcome=SettlementOutcome.LANDED,
        authenticated=True,
    ).state
    x2 = ops.apply_settlement(
        x2,
        outcome=SettlementOutcome.NOT_LANDED,
        authenticated=True,
    ).state
    check(
        "inDoubtDrains",
        x1.execution is ReducerExecution.RECONCILED
        and x2.execution is ReducerExecution.PREPARED,
    )

    # 14 liveness: ordinary work really requests external execution; pre-withdrawn work cannot.
    normal = ops.start(_prepared(ops, "normal"), epoch=1, idempotency_key="key")
    withdrawn_before = ops.request_withdrawal(_prepared(ops, "withdrawn")).state
    superseded_before = ops.request_supersession(
        _prepared(ops, "superseded"),
        superseder_action_id="winner",
    ).state
    withdrawn_start = ops.start(withdrawn_before, epoch=1, idempotency_key="key")
    superseded_start = ops.start(superseded_before, epoch=1, idempotency_key="key")
    check(
        "expectedExecutions",
        normal.accepted
        and normal.state.execution is ReducerExecution.STARTED
        and "provider.execute" in normal.requested_effects
        and not withdrawn_start.accepted
        and not superseded_start.accepted,
    )

    # 15 a reducer must not invent receipt completeness or settle ambiguity on its own.
    check(
        "receiptSourceCompleteness",
        state.execution is ReducerExecution.IN_DOUBT and state.receipt_digest is None,
    )

    # 16 unauthenticated settlement cannot resolve or suppress an uncertain effect.
    forged = ops.apply_settlement(
        state,
        outcome=SettlementOutcome.LANDED,
        authenticated=False,
        receipt_digest="forged",
    )
    check("forgedReceiptRefused", not forged.accepted and forged.state == state)

    # 17 a durable settlement may be re-read after a crash before commit.  Applying the same
    # settlement to the same pre-commit state must deterministically produce the same result.
    first_read = ops.apply_settlement(
        state,
        outcome=SettlementOutcome.LANDED,
        authenticated=True,
        receipt_digest="stable-receipt",
    )
    second_read = ops.apply_settlement(
        state,
        outcome=SettlementOutcome.LANDED,
        authenticated=True,
        receipt_digest="stable-receipt",
    )
    check(
        "receiptRedeliveryIsIdempotent",
        first_read.accepted
        and second_read.accepted
        and first_read.state.execution is ReducerExecution.RECONCILED
        and first_read.state == second_read.state,
    )
    return tuple(out)
