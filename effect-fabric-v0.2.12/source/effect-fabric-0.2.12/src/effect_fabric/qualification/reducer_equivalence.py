"""Equivalence qualification between the active runtime and the v0.2 pure reducer.

The active EffectEngine remains authoritative in v0.2.5.  This module drives real in-memory engine
transitions and the pure reducer through the same semantic traces, then compares the common
execution-state projection.  It intentionally does not claim equivalence for features the active
runtime does not yet expose, such as request withdrawal/supersession.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from ..engine import EffectEngine
from ..errors import AmbiguousEffectError, ProviderErrorKind, ProviderExecutionError
from ..faults import FaultInjector, SimulatedCrash
from ..interfaces import EffectExecutor
from ..models import (
    ActionIntent,
    EffectContract,
    ExecutionAttempt,
    ExecutionState,
    IdempotencyContract,
    PreparedEffect,
    ProviderReceipt,
    ReconciliationStatus,
    ReversibilityClass,
    ReversibilitySpec,
)
from ..reducer import (
    PureEffectState,
    ReducerExecution,
    SettlementOutcome,
    apply_settlement,
    authorize,
    mark_unknown,
    prepare,
    record_provider_failure,
    record_receipt,
    recover_orphaned,
    start,
)
from ..testing import FakeExecutor, FakeVerifier, FakeWorld


RUNTIME_TO_REDUCER = {
    ExecutionState.PLANNED: ReducerExecution.PLANNED,
    ExecutionState.PREPARED: ReducerExecution.PREPARED,
    ExecutionState.AUTHORIZED: ReducerExecution.AUTHORIZED,
    ExecutionState.STARTED: ReducerExecution.STARTED,
    ExecutionState.UNKNOWN: ReducerExecution.IN_DOUBT,
    ExecutionState.RECEIPT_RECORDED: ReducerExecution.RECEIPT_RECORDED,
    ExecutionState.RECONCILED: ReducerExecution.RECONCILED,
    ExecutionState.EXECUTION_FAILED: ReducerExecution.EXECUTION_FAILED,
}


@dataclass(frozen=True)
class EquivalenceResult:
    scenario: str
    passed: bool
    runtime_state: str
    reducer_state: str
    detail: str


class ScriptedFailureExecutor(EffectExecutor):
    name = "scripted"

    def __init__(
        self,
        world: FakeWorld,
        *,
        may_have_happened: bool,
        safe_to_retry: bool,
        reconciliation: ReconciliationStatus = ReconciliationStatus.UNKNOWN,
    ) -> None:
        self.world = world
        self.may_have_happened = may_have_happened
        self.safe_to_retry = safe_to_retry
        self.reconciliation = reconciliation

    async def prepare(self, intent: ActionIntent, contract: EffectContract) -> PreparedEffect:
        del intent, contract
        return PreparedEffect(observed_pre_state=dict(self.world.state), external_version="1")

    async def execute(
        self,
        intent: ActionIntent,
        prepared: PreparedEffect,
        attempt: ExecutionAttempt,
    ) -> ProviderReceipt:
        del intent, prepared, attempt
        if self.may_have_happened:
            raise AmbiguousEffectError("scripted ambiguous transport")
        raise ProviderExecutionError(
            "scripted provider failure",
            kind=(
                ProviderErrorKind.RETRYABLE_PRE_EFFECT
                if self.safe_to_retry
                else ProviderErrorKind.DEFINITIVE_REJECTION
            ),
            may_have_happened=False,
            safe_to_retry=self.safe_to_retry,
        )

    async def reconcile(
        self,
        intent: ActionIntent,
        prepared: PreparedEffect,
        attempt: ExecutionAttempt,
    ) -> ReconciliationStatus:
        del intent, prepared, attempt
        return self.reconciliation


def _domain() -> tuple[
    FakeWorld,
    ActionIntent,
    EffectContract,
    IdempotencyContract,
    ReversibilitySpec,
]:
    world = FakeWorld({"enabled": False, "version": 1})
    intent = ActionIntent(
        subject="equivalence-agent",
        operation="demo.enable",
        resource="demo://equivalence",
        arguments={"mode": "safe"},
    )
    contract = EffectContract(resource=intent.resource, verifier="fake-verifier")
    idem = IdempotencyContract(mechanism="natural_resource", key="equivalence:key")
    rev = ReversibilitySpec(classification=ReversibilityClass.UNKNOWN)
    return world, intent, contract, idem, rev


def _reducer_initial(action_id: str, key: str) -> PureEffectState:
    return PureEffectState(
        action_id=action_id,
        subject_key="equivalence-agent",
        seq=1,
        idempotency_key=key,
    )


def _compare(
    scenario: str,
    runtime: ExecutionState,
    reduced: PureEffectState,
    detail: str,
) -> EquivalenceResult:
    expected = RUNTIME_TO_REDUCER[runtime]
    return EquivalenceResult(
        scenario=scenario,
        passed=expected is reduced.execution,
        runtime_state=runtime.value,
        reducer_state=reduced.execution.value,
        detail=detail,
    )


async def _propose_prepare_authorize(
    engine: EffectEngine,
    intent: ActionIntent,
    contract: EffectContract,
    idem: IdempotencyContract,
    rev: ReversibilitySpec,
    executor_name: str,
):
    tx = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=idem,
        reversibility=rev,
    )
    await engine.prepare(tx.transaction_id, executor_name)
    cap = await engine.authorize(tx.transaction_id, executor_name)
    return tx, cap


async def run_runtime_equivalence() -> tuple[EquivalenceResult, ...]:
    results: list[EquivalenceResult] = []

    # 1. Prepare/authorize ordering is identical to the active runtime.
    world, intent, contract, idem, rev = _domain()
    engine = EffectEngine()
    engine.register_executor(
        FakeExecutor(world, lambda state, _intent: state.update(enabled=True))
    )
    engine.register_verifier(FakeVerifier(world))
    tx = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=idem,
        reversibility=rev,
    )
    reduced = _reducer_initial(tx.transaction_id, idem.key)
    reduced = prepare(reduced).state
    runtime = await engine.prepare(tx.transaction_id, "fake")
    results.append(_compare("prepare", runtime.execution_state, reduced, "PLANNED -> PREPARED"))
    reduced = authorize(reduced).state
    await engine.authorize(tx.transaction_id, "fake")
    runtime = await engine.store.get_transaction(tx.transaction_id)
    results.append(
        _compare("authorize", runtime.execution_state, reduced, "PREPARED -> AUTHORIZED")
    )

    # 2. STARTED is durable before provider I/O.
    world, intent, contract, idem, rev = _domain()
    engine = EffectEngine(faults=FaultInjector(armed={"after_started_persisted"}))
    engine.register_executor(
        FakeExecutor(world, lambda state, _intent: state.update(enabled=True))
    )
    engine.register_verifier(FakeVerifier(world))
    tx, cap = await _propose_prepare_authorize(engine, intent, contract, idem, rev, "fake")
    reduced = authorize(prepare(_reducer_initial(tx.transaction_id, idem.key)).state).state
    reduced = start(reduced, epoch=1, idempotency_key=idem.key).state
    try:
        await engine.execute(tx.transaction_id, cap, worker_id="eq-worker")
    except SimulatedCrash:
        pass
    runtime = await engine.store.get_transaction(tx.transaction_id)
    results.append(
        _compare(
            "started_boundary",
            runtime.execution_state,
            reduced,
            "commit before provider I/O",
        )
    )

    # 3. Successful provider response becomes RECEIPT_RECORDED.
    world, intent, contract, idem, rev = _domain()
    engine = EffectEngine()
    engine.register_executor(
        FakeExecutor(world, lambda state, _intent: state.update(enabled=True))
    )
    engine.register_verifier(FakeVerifier(world))
    tx, cap = await _propose_prepare_authorize(engine, intent, contract, idem, rev, "fake")
    runtime = await engine.execute(tx.transaction_id, cap)
    reduced = authorize(prepare(_reducer_initial(tx.transaction_id, idem.key)).state).state
    reduced = start(reduced, epoch=1, idempotency_key=idem.key).state
    reduced = record_receipt(reduced, epoch=1, receipt_digest="runtime-receipt").state
    results.append(
        _compare(
            "receipt_success",
            runtime.execution_state,
            reduced,
            "provider response persisted",
        )
    )

    # 4. Ambiguous transport becomes UNKNOWN / IN_DOUBT.
    world, intent, contract, idem, rev = _domain()
    engine = EffectEngine()
    engine.register_executor(
        FakeExecutor(
            world,
            lambda state, _intent: state.update(enabled=True),
            ambiguous_after_effect=True,
        )
    )
    engine.register_verifier(FakeVerifier(world))
    tx, cap = await _propose_prepare_authorize(engine, intent, contract, idem, rev, "fake")
    runtime = await engine.execute(tx.transaction_id, cap)
    reduced = authorize(prepare(_reducer_initial(tx.transaction_id, idem.key)).state).state
    reduced = start(reduced, epoch=1, idempotency_key=idem.key).state
    reduced = mark_unknown(reduced, epoch=1).state
    results.append(
        _compare(
            "ambiguous_unknown",
            runtime.execution_state,
            reduced,
            "ambiguous effect is not retried",
        )
    )

    # 5. Authoritative reconciliation proving LANDED becomes RECONCILED.
    status = await engine.reconcile(tx.transaction_id)
    runtime = await engine.store.get_transaction(tx.transaction_id)
    reduced = apply_settlement(
        reduced,
        outcome=SettlementOutcome.LANDED,
        authenticated=True,
        receipt_digest="authoritative",
    ).state
    results.append(
        _compare(
            "reconcile_landed",
            runtime.execution_state,
            reduced,
            f"status={status.value}",
        )
    )

    # 6. Authoritative NOT_HAPPENED returns to PREPARED and requires fresh authorization.
    world, intent, contract, idem, rev = _domain()
    engine = EffectEngine()
    engine.register_executor(
        ScriptedFailureExecutor(
            world,
            may_have_happened=True,
            safe_to_retry=False,
            reconciliation=ReconciliationStatus.NOT_HAPPENED,
        )
    )
    engine.register_verifier(FakeVerifier(world))
    tx, cap = await _propose_prepare_authorize(engine, intent, contract, idem, rev, "scripted")
    runtime_unknown = await engine.execute(tx.transaction_id, cap)
    reduced = authorize(prepare(_reducer_initial(tx.transaction_id, idem.key)).state).state
    reduced = start(reduced, epoch=1, idempotency_key=idem.key).state
    reduced = mark_unknown(reduced, epoch=1).state
    if runtime_unknown.execution_state is not ExecutionState.UNKNOWN:
        raise AssertionError("scripted executor did not enter UNKNOWN")
    status = await engine.reconcile(tx.transaction_id)
    runtime = await engine.store.get_transaction(tx.transaction_id)
    reduced = apply_settlement(
        reduced,
        outcome=SettlementOutcome.NOT_LANDED,
        authenticated=True,
    ).state
    results.append(
        _compare(
            "reconcile_not_landed",
            runtime.execution_state,
            reduced,
            f"status={status.value}",
        )
    )

    # 7. Proven pre-effect retryable failure returns to PREPARED.
    world, intent, contract, idem, rev = _domain()
    engine = EffectEngine()
    engine.register_executor(
        ScriptedFailureExecutor(world, may_have_happened=False, safe_to_retry=True)
    )
    engine.register_verifier(FakeVerifier(world))
    tx, cap = await _propose_prepare_authorize(engine, intent, contract, idem, rev, "scripted")
    try:
        await engine.execute(tx.transaction_id, cap)
    except ProviderExecutionError:
        pass
    runtime = await engine.store.get_transaction(tx.transaction_id)
    reduced = authorize(prepare(_reducer_initial(tx.transaction_id, idem.key)).state).state
    reduced = start(reduced, epoch=1, idempotency_key=idem.key).state
    reduced = record_provider_failure(
        reduced,
        epoch=1,
        may_have_happened=False,
        safe_to_retry=True,
    ).state
    results.append(
        _compare(
            "retryable_pre_effect_failure",
            runtime.execution_state,
            reduced,
            "fresh auth required",
        )
    )

    # 8. Proven non-retryable pre-effect failure is terminal EXECUTION_FAILED.
    world, intent, contract, idem, rev = _domain()
    engine = EffectEngine()
    engine.register_executor(
        ScriptedFailureExecutor(world, may_have_happened=False, safe_to_retry=False)
    )
    engine.register_verifier(FakeVerifier(world))
    tx, cap = await _propose_prepare_authorize(engine, intent, contract, idem, rev, "scripted")
    try:
        await engine.execute(tx.transaction_id, cap)
    except ProviderExecutionError:
        pass
    runtime = await engine.store.get_transaction(tx.transaction_id)
    reduced = authorize(prepare(_reducer_initial(tx.transaction_id, idem.key)).state).state
    reduced = start(reduced, epoch=1, idempotency_key=idem.key).state
    reduced = record_provider_failure(
        reduced,
        epoch=1,
        may_have_happened=False,
        safe_to_retry=False,
    ).state
    results.append(
        _compare(
            "definitive_failure",
            runtime.execution_state,
            reduced,
            "terminal provider rejection",
        )
    )

    # 9. Orphan recovery fences the old worker and conservatively moves STARTED -> UNKNOWN.
    world, intent, contract, idem, rev = _domain()
    engine = EffectEngine(faults=FaultInjector(armed={"after_started_persisted"}))
    engine.register_executor(
        FakeExecutor(world, lambda state, _intent: state.update(enabled=True))
    )
    engine.register_verifier(FakeVerifier(world))
    tx, cap = await _propose_prepare_authorize(engine, intent, contract, idem, rev, "fake")
    try:
        await engine.execute(tx.transaction_id, cap, worker_id="old", lease_seconds=1)
    except SimulatedCrash:
        pass
    started_tx = await engine.store.get_transaction(tx.transaction_id)
    attempt = await engine.store.get_attempt(started_tx.latest_attempt_id)
    runtime = await engine.recover_orphaned_started(
        tx.transaction_id,
        now=attempt.lease_expires_at + timedelta(microseconds=1),
    )
    reduced = authorize(prepare(_reducer_initial(tx.transaction_id, idem.key)).state).state
    reduced = start(reduced, epoch=1, idempotency_key=idem.key).state
    reduced = recover_orphaned(reduced, new_epoch=2).state
    equivalent = _compare(
        "orphan_recovery",
        runtime.execution_state,
        reduced,
        "fencing epoch advanced",
    )
    results.append(
        EquivalenceResult(
            scenario=equivalent.scenario,
            passed=equivalent.passed and runtime.fencing_epoch == reduced.fencing_epoch == 2,
            runtime_state=equivalent.runtime_state,
            reducer_state=equivalent.reducer_state,
            detail=(
                f"{equivalent.detail}; runtime_epoch={runtime.fencing_epoch}; "
                f"reducer_epoch={reduced.fencing_epoch}"
            ),
        )
    )

    return tuple(results)
