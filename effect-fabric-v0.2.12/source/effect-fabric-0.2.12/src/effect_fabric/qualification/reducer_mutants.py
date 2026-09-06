"""Deliberately broken reducer adapters used as negative controls.

Each mutant models one plausible production defect derived from durable-agent-outbox's published
negative-control strategy.  These are test-only adapters: they are not imported by the runtime.
The qualification contract requires each mutant to fail its declared scenario floor.
"""
from __future__ import annotations

from dataclasses import dataclass, replace

from .donor_conformance import (
    SCENARIO_IDS,
    ReferenceReducerOps,
    ReducerOps,
    ScenarioResult,
    run_internal_scenarios,
)
from ..reducer import (
    PureEffectState,
    ReduceResult,
    ReducerError,
    ReducerExecution,
    RequestDisposition,
    SettlementOutcome,
)


class EagerResolveOps(ReferenceReducerOps):
    """BUG: resolves ambiguity locally rather than waiting for authoritative settlement."""

    def apply_settlement(
        self,
        state: PureEffectState,
        *,
        outcome: SettlementOutcome,
        authenticated: bool,
        receipt_digest: str | None = None,
    ) -> ReduceResult:
        if (
            state.execution is ReducerExecution.IN_DOUBT
            and outcome is SettlementOutcome.INCONCLUSIVE
        ):
            outcome = SettlementOutcome.LANDED
            receipt_digest = receipt_digest or "presumed"
        return super().apply_settlement(
            state,
            outcome=outcome,
            authenticated=authenticated,
            receipt_digest=receipt_digest,
        )

    def request_withdrawal(self, state: PureEffectState) -> ReduceResult:
        if state.execution is ReducerExecution.IN_DOUBT:
            presumed = super().apply_settlement(
                state,
                outcome=SettlementOutcome.LANDED,
                authenticated=True,
                receipt_digest="presumed-before-withdrawal",
            ).state
            return super().request_withdrawal(presumed)
        return super().request_withdrawal(state)


class AckedRevokedOps(ReferenceReducerOps):
    """BUG: rewrites finished work as if it had been withdrawn before execution."""

    def request_withdrawal(self, state: PureEffectState) -> ReduceResult:
        if state.execution in {ReducerExecution.RECEIPT_RECORDED, ReducerExecution.RECONCILED}:
            changed = replace(
                state,
                revision=state.revision + 1,
                disposition=RequestDisposition.WITHDRAWN_BEFORE_EFFECT,
                audit=(*state.audit, "mutant:acked_revoked"),
            )
            return ReduceResult(state=changed)
        return super().request_withdrawal(state)


class StrandsInDoubtOps(ReferenceReducerOps):
    """BUG: authoritative settlements exist but the implementation never applies them."""

    def apply_settlement(
        self,
        state: PureEffectState,
        *,
        outcome: SettlementOutcome,
        authenticated: bool,
        receipt_digest: str | None = None,
    ) -> ReduceResult:
        del outcome, authenticated, receipt_digest
        if state.execution is ReducerExecution.IN_DOUBT:
            return ReduceResult(state=state)
        return super().apply_settlement(
            state,
            outcome=SettlementOutcome.INCONCLUSIVE,
            authenticated=True,
        )


class DeliveryKeyedOps(ReferenceReducerOps):
    """BUG: transport delivery identity contaminates the stable provider idempotency key."""

    def record_delivery(self, state: PureEffectState, delivery_id: str) -> ReduceResult:
        poisoned = replace(state, idempotency_key=f"{state.idempotency_key}:{delivery_id}")
        return super().record_delivery(poisoned, delivery_id)


class SelfRevokeOps(ReferenceReducerOps):
    """BUG: makes safety vacuous by suppressing all external execution."""

    def start(
        self,
        state: PureEffectState,
        *,
        epoch: int,
        idempotency_key: str,
    ) -> ReduceResult:
        del epoch, idempotency_key
        changed = replace(
            state,
            revision=state.revision + 1,
            execution=ReducerExecution.EXECUTION_FAILED,
            disposition=RequestDisposition.WITHDRAWN_BEFORE_EFFECT,
            audit=(*state.audit, "mutant:self_revoke"),
        )
        return ReduceResult(state=changed)


class TrustsAnyReceiptOps(ReferenceReducerOps):
    """BUG: treats an unauthenticated settlement feed as authoritative."""

    def apply_settlement(
        self,
        state: PureEffectState,
        *,
        outcome: SettlementOutcome,
        authenticated: bool,
        receipt_digest: str | None = None,
    ) -> ReduceResult:
        del authenticated
        return super().apply_settlement(
            state,
            outcome=outcome,
            authenticated=True,
            receipt_digest=receipt_digest,
        )


class NoncesAreConsumedOps(ReferenceReducerOps):
    """BUG: consumes a settlement on sight, so a post-crash re-read is refused."""

    def __init__(self) -> None:
        self._seen: set[tuple[str, str | None]] = set()

    def apply_settlement(
        self,
        state: PureEffectState,
        *,
        outcome: SettlementOutcome,
        authenticated: bool,
        receipt_digest: str | None = None,
    ) -> ReduceResult:
        key = (state.action_id, receipt_digest)
        if receipt_digest is not None and key in self._seen:
            return ReduceResult(
                state=state,
                accepted=False,
                error=ReducerError.RECEIPT_UNAUTHENTICATED,
            )
        if receipt_digest is not None:
            self._seen.add(key)
        return super().apply_settlement(
            state,
            outcome=outcome,
            authenticated=authenticated,
            receipt_digest=receipt_digest,
        )


class NopOps(ReferenceReducerOps):
    """BUG: accepts inputs but never advances any lifecycle state."""

    @staticmethod
    def _noop(state: PureEffectState) -> ReduceResult:
        return ReduceResult(state=state)

    def record_delivery(self, state: PureEffectState, delivery_id: str) -> ReduceResult:
        del delivery_id
        return self._noop(state)

    def prepare(self, state: PureEffectState) -> ReduceResult:
        return self._noop(state)

    def authorize(self, state: PureEffectState) -> ReduceResult:
        return self._noop(state)

    def start(
        self,
        state: PureEffectState,
        *,
        epoch: int,
        idempotency_key: str,
    ) -> ReduceResult:
        del epoch, idempotency_key
        return self._noop(state)

    def mark_unknown(self, state: PureEffectState, *, epoch: int) -> ReduceResult:
        del epoch
        return self._noop(state)

    def record_receipt(
        self,
        state: PureEffectState,
        *,
        epoch: int,
        receipt_digest: str,
    ) -> ReduceResult:
        del epoch, receipt_digest
        return self._noop(state)

    def request_withdrawal(self, state: PureEffectState) -> ReduceResult:
        return self._noop(state)

    def request_supersession(
        self,
        state: PureEffectState,
        *,
        superseder_action_id: str,
    ) -> ReduceResult:
        del superseder_action_id
        return self._noop(state)

    def apply_settlement(
        self,
        state: PureEffectState,
        *,
        outcome: SettlementOutcome,
        authenticated: bool,
        receipt_digest: str | None = None,
    ) -> ReduceResult:
        del outcome, authenticated, receipt_digest
        return self._noop(state)

    def acknowledge(self, state: PureEffectState) -> ReduceResult:
        return self._noop(state)


@dataclass(frozen=True)
class MutantSpec:
    id: str
    description: str
    must_fail: tuple[str, ...]
    factory: type[ReducerOps]


ALL_MUTANTS: tuple[MutantSpec, ...] = (
    MutantSpec(
        "eagerResolve",
        "leaves IN_DOUBT by presuming LANDED without authoritative settlement",
        ("unknownWaitsForReceipt", "unknownRevokeLanded", "unknownRevokeNotLanded"),
        EagerResolveOps,
    ),
    MutantSpec(
        "ackedRevoked",
        "rewrites completed work as withdrawn before execution",
        ("ackedCannotBecomeRevoked",),
        AckedRevokedOps,
    ),
    MutantSpec(
        "strandsInDoubt",
        "never applies available authoritative settlements",
        ("progressUnderInDoubt", "inDoubtDrains"),
        StrandsInDoubtOps,
    ),
    MutantSpec(
        "deliveryKeyed",
        "derives provider idempotency identity from transport delivery",
        ("duplicateDelivery", "idempotencyKeyStability"),
        DeliveryKeyedOps,
    ),
    MutantSpec(
        "selfRevoke",
        "suppresses all execution and therefore passes safety vacuously",
        ("expectedExecutions",),
        SelfRevokeOps,
    ),
    MutantSpec(
        "trustsAnyReceipt",
        "accepts forged or unauthenticated settlements",
        ("forgedReceiptRefused",),
        TrustsAnyReceiptOps,
    ),
    MutantSpec(
        "noncesAreConsumed",
        "refuses a legitimate re-read of durable settlement evidence",
        ("receiptRedeliveryIsIdempotent",),
        NoncesAreConsumedOps,
    ),
    MutantSpec(
        "nop",
        "accepts work but never advances or executes anything",
        SCENARIO_IDS,
        NopOps,
    ),
)


@dataclass(frozen=True)
class MutantResult:
    mutant: str
    passed_suite: bool
    failed_scenarios: tuple[str, ...]
    required_failures: tuple[str, ...]
    required_failures_observed: bool
    crashed: bool = False
    error: str | None = None


def run_negative_controls() -> tuple[MutantResult, ...]:
    results: list[MutantResult] = []
    for spec in ALL_MUTANTS:
        try:
            scenario_results: tuple[ScenarioResult, ...] = run_internal_scenarios(spec.factory())
            failed = tuple(result.scenario for result in scenario_results if not result.passed)
            required = all(scenario in failed for scenario in spec.must_fail)
            results.append(
                MutantResult(
                    mutant=spec.id,
                    passed_suite=not failed,
                    failed_scenarios=failed,
                    required_failures=spec.must_fail,
                    required_failures_observed=required,
                )
            )
        except Exception as exc:  # negative controls must fail checks, not merely crash
            results.append(
                MutantResult(
                    mutant=spec.id,
                    passed_suite=False,
                    failed_scenarios=(),
                    required_failures=spec.must_fail,
                    required_failures_observed=False,
                    crashed=True,
                    error=f"{type(exc).__name__}: {exc}",
                )
            )
    return tuple(results)
