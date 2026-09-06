"""Pure consequential-effect lifecycle reducer.

The reducer is deliberately deterministic and side-effect free.  It never reads clocks,
environment variables, files, networks, databases, credentials, randomness, or process state.
Every fact needed to make a decision is supplied explicitly by the caller.  The reducer returns a
new immutable state plus declarative effects for the outer runtime to persist or execute.

v0.2.5 aligns the reducer's prepare/authorize ordering with the proven Effect Fabric runtime and
adds explicit provider-failure and orphan-recovery commands so runtime/reducer equivalence can be
qualified across the common lifecycle.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from enum import StrEnum

from .transition_kernel import assert_legal_execution_edge


class ReducerExecution(StrEnum):
    PLANNED = "planned"
    PREPARED = "prepared"
    AUTHORIZED = "authorized"
    STARTED = "started"
    IN_DOUBT = "in_doubt"
    RECEIPT_RECORDED = "receipt_recorded"
    RECONCILED = "reconciled"
    EXECUTION_FAILED = "execution_failed"


class RequestDisposition(StrEnum):
    ACTIVE = "active"
    WITHDRAW_REQUESTED = "withdraw_requested"
    SUPERSEDE_REQUESTED = "supersede_requested"
    WITHDRAWN_BEFORE_EFFECT = "withdrawn_before_effect"
    SUPERSEDED_BEFORE_EFFECT = "superseded_before_effect"
    EFFECT_THEN_WITHDRAWN = "effect_then_withdrawn"
    EFFECT_THEN_SUPERSEDED = "effect_then_superseded"


class SettlementOutcome(StrEnum):
    LANDED = "landed"
    NOT_LANDED = "not_landed"
    INCONCLUSIVE = "inconclusive"


class ReducerError(StrEnum):
    INVALID_TRANSITION = "invalid_transition"
    STALE_EPOCH = "stale_epoch"
    RECEIPT_UNAUTHENTICATED = "receipt_unauthenticated"
    IDEMPOTENCY_KEY_MISMATCH = "idempotency_key_mismatch"
    TERMINAL = "terminal"


@dataclass(frozen=True)
class PureEffectState:
    action_id: str
    subject_key: str
    seq: int
    idempotency_key: str
    execution: ReducerExecution = ReducerExecution.PLANNED
    disposition: RequestDisposition = RequestDisposition.ACTIVE
    revision: int = 0
    fencing_epoch: int = 0
    attempted: bool = False
    receipt_digest: str | None = None
    superseded_by: str | None = None
    deliveries: tuple[str, ...] = ()
    audit: tuple[str, ...] = ()


@dataclass(frozen=True)
class ReduceResult:
    state: PureEffectState
    accepted: bool = True
    error: ReducerError | None = None
    requested_effects: tuple[str, ...] = ()


def _canonical_execution(value: ReducerExecution) -> str:
    return "unknown" if value is ReducerExecution.IN_DOUBT else value.value


def _commit(state: PureEffectState, event: str, **changes: object) -> PureEffectState:
    execution = changes.get("execution")
    if isinstance(execution, ReducerExecution):
        assert_legal_execution_edge(
            _canonical_execution(state.execution),
            _canonical_execution(execution),
        )
    return replace(state, revision=state.revision + 1, audit=(*state.audit, event), **changes)


def _reject(state: PureEffectState, error: ReducerError) -> ReduceResult:
    return ReduceResult(state=state, accepted=False, error=error)


def record_delivery(state: PureEffectState, delivery_id: str) -> ReduceResult:
    """Record a transport delivery without allowing it to alter action identity."""
    if delivery_id in state.deliveries:
        return ReduceResult(state=state)
    return ReduceResult(
        state=_commit(state, f"delivery:{delivery_id}", deliveries=(*state.deliveries, delivery_id))
    )


def prepare(state: PureEffectState) -> ReduceResult:
    if state.execution is not ReducerExecution.PLANNED:
        return _reject(state, ReducerError.INVALID_TRANSITION)
    return ReduceResult(state=_commit(state, "prepared", execution=ReducerExecution.PREPARED))


def authorize(state: PureEffectState) -> ReduceResult:
    """Authorize a prepared action.

    Reauthorization while already AUTHORIZED is state-idempotent.  Capability replacement is an
    outer-runtime fact; the pure lifecycle state remains AUTHORIZED.
    """
    if state.execution is ReducerExecution.AUTHORIZED:
        return ReduceResult(state=state)
    if state.execution is not ReducerExecution.PREPARED:
        return _reject(state, ReducerError.INVALID_TRANSITION)
    return ReduceResult(state=_commit(state, "authorized", execution=ReducerExecution.AUTHORIZED))


def start(state: PureEffectState, *, epoch: int, idempotency_key: str) -> ReduceResult:
    if state.disposition in {
        RequestDisposition.WITHDRAWN_BEFORE_EFFECT,
        RequestDisposition.SUPERSEDED_BEFORE_EFFECT,
    }:
        return _reject(state, ReducerError.TERMINAL)
    if state.execution is not ReducerExecution.AUTHORIZED:
        return _reject(state, ReducerError.INVALID_TRANSITION)
    if idempotency_key != state.idempotency_key:
        return _reject(state, ReducerError.IDEMPOTENCY_KEY_MISMATCH)
    if epoch <= state.fencing_epoch:
        return _reject(state, ReducerError.STALE_EPOCH)
    new = _commit(
        state,
        f"started:{epoch}",
        execution=ReducerExecution.STARTED,
        fencing_epoch=epoch,
        attempted=True,
    )
    return ReduceResult(state=new, requested_effects=("provider.execute",))


def mark_unknown(state: PureEffectState, *, epoch: int) -> ReduceResult:
    if epoch != state.fencing_epoch:
        return _reject(state, ReducerError.STALE_EPOCH)
    if state.execution is not ReducerExecution.STARTED:
        return _reject(state, ReducerError.INVALID_TRANSITION)
    return ReduceResult(
        state=_commit(state, "unknown", execution=ReducerExecution.IN_DOUBT),
        requested_effects=("provider.reconcile",),
    )


def recover_orphaned(state: PureEffectState, *, new_epoch: int) -> ReduceResult:
    """Fence a dead STARTED worker and conservatively move the effect to IN_DOUBT."""
    if state.execution is not ReducerExecution.STARTED:
        return _reject(state, ReducerError.INVALID_TRANSITION)
    if new_epoch <= state.fencing_epoch:
        return _reject(state, ReducerError.STALE_EPOCH)
    new = _commit(
        state,
        f"orphan_recovered:{new_epoch}",
        execution=ReducerExecution.IN_DOUBT,
        fencing_epoch=new_epoch,
        attempted=True,
    )
    return ReduceResult(state=new, requested_effects=("provider.reconcile",))


def record_provider_failure(
    state: PureEffectState,
    *,
    epoch: int,
    may_have_happened: bool,
    safe_to_retry: bool,
) -> ReduceResult:
    """Classify a provider failure using explicit ambiguity facts from the adapter."""
    if epoch != state.fencing_epoch:
        return _reject(state, ReducerError.STALE_EPOCH)
    if state.execution is not ReducerExecution.STARTED:
        return _reject(state, ReducerError.INVALID_TRANSITION)
    if may_have_happened:
        return ReduceResult(
            state=_commit(state, "provider_failure:unknown", execution=ReducerExecution.IN_DOUBT),
            requested_effects=("provider.reconcile",),
        )
    if safe_to_retry:
        return ReduceResult(
            state=_commit(
                state,
                "provider_failure:retryable_pre_effect",
                execution=ReducerExecution.PREPARED,
            ),
            requested_effects=("authorization.refresh_required",),
        )
    return ReduceResult(
        state=_commit(
            state,
            "provider_failure:definitive",
            execution=ReducerExecution.EXECUTION_FAILED,
        )
    )


def record_receipt(state: PureEffectState, *, epoch: int, receipt_digest: str) -> ReduceResult:
    if epoch != state.fencing_epoch:
        return _reject(state, ReducerError.STALE_EPOCH)
    if state.execution not in {ReducerExecution.STARTED, ReducerExecution.IN_DOUBT}:
        return _reject(state, ReducerError.INVALID_TRANSITION)
    new = _commit(
        state,
        f"receipt:{receipt_digest}",
        execution=ReducerExecution.RECEIPT_RECORDED,
        receipt_digest=receipt_digest,
    )
    return ReduceResult(state=new)


def request_withdrawal(state: PureEffectState) -> ReduceResult:
    if state.execution in {
        ReducerExecution.RECEIPT_RECORDED,
        ReducerExecution.RECONCILED,
    }:
        return _reject(state, ReducerError.TERMINAL)
    if state.execution in {
        ReducerExecution.PLANNED,
        ReducerExecution.PREPARED,
        ReducerExecution.AUTHORIZED,
    } and not state.attempted:
        return ReduceResult(
            state=_commit(
                state,
                "withdrawn_before_effect",
                disposition=RequestDisposition.WITHDRAWN_BEFORE_EFFECT,
            )
        )
    if state.disposition is RequestDisposition.WITHDRAW_REQUESTED:
        return ReduceResult(state=state)
    return ReduceResult(
        state=_commit(
            state,
            "withdraw_requested",
            disposition=RequestDisposition.WITHDRAW_REQUESTED,
        )
    )


def request_supersession(state: PureEffectState, *, superseder_action_id: str) -> ReduceResult:
    if state.execution in {
        ReducerExecution.PLANNED,
        ReducerExecution.PREPARED,
        ReducerExecution.AUTHORIZED,
    } and not state.attempted:
        return ReduceResult(
            state=_commit(
                state,
                f"superseded_before_effect:{superseder_action_id}",
                disposition=RequestDisposition.SUPERSEDED_BEFORE_EFFECT,
                superseded_by=superseder_action_id,
            )
        )
    if state.execution in {ReducerExecution.RECEIPT_RECORDED, ReducerExecution.RECONCILED}:
        return _reject(state, ReducerError.TERMINAL)
    return ReduceResult(
        state=_commit(
            state,
            f"supersede_requested:{superseder_action_id}",
            disposition=RequestDisposition.SUPERSEDE_REQUESTED,
            superseded_by=superseder_action_id,
        )
    )


def apply_settlement(
    state: PureEffectState,
    *,
    outcome: SettlementOutcome,
    authenticated: bool,
    receipt_digest: str | None = None,
) -> ReduceResult:
    if state.execution is not ReducerExecution.IN_DOUBT:
        return _reject(state, ReducerError.INVALID_TRANSITION)
    if not authenticated:
        return _reject(state, ReducerError.RECEIPT_UNAUTHENTICATED)
    if outcome is SettlementOutcome.INCONCLUSIVE:
        return ReduceResult(state=state)
    if outcome is SettlementOutcome.LANDED:
        disposition = state.disposition
        if disposition is RequestDisposition.WITHDRAW_REQUESTED:
            disposition = RequestDisposition.EFFECT_THEN_WITHDRAWN
        elif disposition is RequestDisposition.SUPERSEDE_REQUESTED:
            disposition = RequestDisposition.EFFECT_THEN_SUPERSEDED
        new = _commit(
            state,
            f"settlement:landed:{receipt_digest or ''}",
            execution=ReducerExecution.RECONCILED,
            disposition=disposition,
            receipt_digest=receipt_digest,
        )
        return ReduceResult(state=new)

    if state.disposition is RequestDisposition.WITHDRAW_REQUESTED:
        new = _commit(
            state,
            "settlement:not_landed:withdrawn",
            execution=ReducerExecution.EXECUTION_FAILED,
            disposition=RequestDisposition.WITHDRAWN_BEFORE_EFFECT,
        )
        return ReduceResult(state=new)
    if state.disposition is RequestDisposition.SUPERSEDE_REQUESTED:
        new = _commit(
            state,
            "settlement:not_landed:superseded",
            execution=ReducerExecution.EXECUTION_FAILED,
            disposition=RequestDisposition.SUPERSEDED_BEFORE_EFFECT,
        )
        return ReduceResult(state=new)

    new = _commit(state, "settlement:not_landed", execution=ReducerExecution.PREPARED)
    return ReduceResult(state=new, requested_effects=("authorization.refresh_required",))


def acknowledge(state: PureEffectState) -> ReduceResult:
    if state.execution not in {ReducerExecution.RECEIPT_RECORDED, ReducerExecution.RECONCILED}:
        return _reject(state, ReducerError.INVALID_TRANSITION)
    if "acknowledged" in state.audit:
        return ReduceResult(state=state)
    return ReduceResult(state=_commit(state, "acknowledged"))
