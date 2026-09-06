from datetime import timedelta

import pytest

from effect_fabric.errors import CapabilityConsumed, LeaseNotExpired, StaleFence
from effect_fabric.faults import FaultInjector, SimulatedCrash
from effect_fabric.models import (
    AttemptState,
    ExecutionState,
    ReconciliationStatus,
    VerificationState,
)


@pytest.mark.asyncio
async def test_crash_after_provider_return_is_recovered_as_unknown_then_reconciled(basic):
    engine, world, intent, contract, idem, rev = basic
    engine.faults = FaultInjector(armed={"after_provider_returned"})
    tx = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=idem,
        reversibility=rev,
    )
    await engine.prepare(tx.transaction_id, "fake")
    cap = await engine.authorize(tx.transaction_id, "fake")

    with pytest.raises(SimulatedCrash):
        await engine.execute(tx.transaction_id, cap, worker_id="worker-a", lease_seconds=1)

    started = await engine.store.get_transaction(tx.transaction_id)
    assert started.execution_state == ExecutionState.STARTED
    assert world.effect_count == 1
    attempt = await engine.store.get_attempt(started.latest_attempt_id)
    assert attempt.state == AttemptState.ACTIVE

    with pytest.raises(LeaseNotExpired):
        await engine.recover_orphaned_started(tx.transaction_id, now=attempt.started_at)

    recovered = await engine.recover_orphaned_started(
        tx.transaction_id,
        now=attempt.lease_expires_at + timedelta(microseconds=1),
    )
    assert recovered.execution_state == ExecutionState.UNKNOWN
    assert recovered.fencing_epoch == attempt.fencing_epoch + 1

    status = await engine.reconcile(tx.transaction_id)
    assert status == ReconciliationStatus.HAPPENED
    reconciled = await engine.store.get_transaction(tx.transaction_id)
    assert reconciled.execution_state == ExecutionState.RECONCILED
    assert world.effect_count == 1
    attestation = await engine.verify(tx.transaction_id)
    assert attestation.state == VerificationState.VERIFIED


@pytest.mark.asyncio
async def test_orphan_recovery_fences_late_worker_write(basic):
    engine, _world, intent, contract, idem, rev = basic
    tx = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=idem,
        reversibility=rev,
    )
    await engine.prepare(tx.transaction_id, "fake")
    cap = await engine.authorize(tx.transaction_id, "fake")
    attempt = await engine.store.consume_capability_and_start(
        capability_id=cap.capability_id,
        transaction_id=tx.transaction_id,
        executor="fake",
        worker_id="old-worker",
        lease_seconds=1,
    )
    await engine.recover_orphaned_started(
        tx.transaction_id,
        now=attempt.lease_expires_at + timedelta(seconds=1),
    )
    late = await engine.store.get_transaction(tx.transaction_id)
    late.execution_state = ExecutionState.RECEIPT_RECORDED
    with pytest.raises(StaleFence):
        await engine.store.save_transaction(late, expected_fence=attempt.fencing_epoch)


@pytest.mark.asyncio
async def test_parallel_capability_consumption_has_one_winner(basic):
    import asyncio

    engine, _world, intent, contract, idem, rev = basic
    tx = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=idem,
        reversibility=rev,
    )
    await engine.prepare(tx.transaction_id, "fake")
    cap = await engine.authorize(tx.transaction_id, "fake")

    async def consume(worker):
        try:
            result = await engine.store.consume_capability_and_start(
                capability_id=cap.capability_id,
                transaction_id=tx.transaction_id,
                executor="fake",
                worker_id=worker,
            )
            return result
        except CapabilityConsumed:
            return None

    results = await asyncio.gather(consume("a"), consume("b"))
    winners = [item for item in results if item is not None]
    assert len(winners) == 1
    assert winners[0].lease_owner in {"a", "b"}


@pytest.mark.asyncio
async def test_completed_attempt_records_terminal_state(basic):
    engine, _world, intent, contract, idem, rev = basic
    tx = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=idem,
        reversibility=rev,
    )
    await engine.prepare(tx.transaction_id, "fake")
    cap = await engine.authorize(tx.transaction_id, "fake")
    current = await engine.execute(tx.transaction_id, cap)
    attempt = await engine.store.get_attempt(current.latest_attempt_id)
    assert attempt.state == AttemptState.SUCCEEDED
    assert attempt.finished_at is not None
