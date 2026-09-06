from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import pytest

from effect_fabric.faults import FaultInjector, SimulatedCrash
from effect_fabric.ledger import FileHashChainLedger, HashChainLedger
from effect_fabric.models import ExecutionState
from effect_fabric.outbox import EvidenceIntent, EvidenceOutboxDispatcher
from effect_fabric.store import InMemoryStore


@pytest.mark.asyncio
async def test_started_state_and_evidence_intent_survive_crash_before_ledger_flush(basic):
    engine, world, intent, contract, idem, rev = basic
    engine.faults = FaultInjector(armed={"after_started_transition_committed"})
    tx = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=idem,
        reversibility=rev,
    )
    await engine.prepare(tx.transaction_id, "fake")
    cap = await engine.authorize(tx.transaction_id, "fake")
    count_before = engine.ledger.count

    with pytest.raises(SimulatedCrash):
        await engine.execute(tx.transaction_id, cap)

    current = await engine.store.get_transaction(tx.transaction_id)
    assert current.execution_state == ExecutionState.STARTED
    assert world.effect_count == 0
    assert await engine.store.pending_evidence_count() == 1
    assert engine.ledger.count == count_before

    engine.faults.armed.clear()
    events = await engine.flush_evidence()
    assert len(events) == 1
    assert events[0].event_type == "effect.started"
    assert events[0].source_outbox_id is not None
    assert await engine.store.pending_evidence_count() == 0


@pytest.mark.asyncio
async def test_dispatch_crash_after_append_is_idempotent_on_redelivery(tmp_path):
    store = InMemoryStore()
    ledger = FileHashChainLedger(tmp_path / "ledger.jsonl")
    item = await store.enqueue_evidence(
        "tx-1",
        EvidenceIntent(event_type="effect.atomic", payload={"n": 1}),
    )
    dispatcher = EvidenceOutboxDispatcher(store, ledger, worker_id="d1", lease_seconds=1)

    def crash_after_append(_item, _event):
        raise SimulatedCrash("after_evidence_append_before_ack")

    with pytest.raises(SimulatedCrash):
        await dispatcher.dispatch_one(after_append_hook=crash_after_append)
    assert ledger.count == 1
    first_event = ledger.events()[0]
    assert first_event.source_outbox_id == item.outbox_id

    # Simulate lease expiry without sleeping; a replacement dispatcher may now reclaim the row.
    store._outbox[item.outbox_id].claim_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    replacement = EvidenceOutboxDispatcher(store, ledger, worker_id="d2")
    replayed = await replacement.dispatch_one()
    assert replayed is not None
    assert replayed.event_id == first_event.event_id
    assert ledger.count == 1
    assert await store.pending_evidence_count() == 0


@pytest.mark.asyncio
async def test_hash_chain_deduplicates_same_outbox_id():
    ledger = HashChainLedger()
    first = ledger.append("tx", "e", {"x": 1}, source_outbox_id="outbox-1")
    second = ledger.append("tx", "e", {"x": 1}, source_outbox_id="outbox-1")
    assert first.event_id == second.event_id
    assert ledger.count == 1
    assert ledger.verify()


@pytest.mark.asyncio
async def test_success_transition_and_attempt_completion_share_evidence_commit(basic):
    engine, _world, intent, contract, idem, rev = basic
    tx = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=idem,
        reversibility=rev,
    )
    await engine.prepare(tx.transaction_id, "fake")
    cap = await engine.authorize(tx.transaction_id, "fake")
    result = await engine.execute(tx.transaction_id, cap)
    attempt = await engine.store.get_attempt(result.latest_attempt_id)
    assert result.execution_state == ExecutionState.RECEIPT_RECORDED
    assert attempt.state.value == "succeeded"
    assert await engine.store.pending_evidence_count() == 0
    receipt_events = [
        event
        for event in engine.ledger.events()
        if event.event_type == "effect.receipt_recorded"
    ]
    assert len(receipt_events) == 1
    assert receipt_events[0].source_outbox_id is not None


@pytest.mark.asyncio
async def test_all_engine_generated_events_are_outbox_sourced(basic):
    engine, _world, intent, contract, idem, rev = basic
    tx = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=idem,
        reversibility=rev,
    )
    await engine.prepare(tx.transaction_id, "fake")
    cap = await engine.authorize(tx.transaction_id, "fake")
    await engine.execute(tx.transaction_id, cap)
    await engine.verify(tx.transaction_id)
    events = engine.ledger.events()
    assert events
    assert all(event.source_outbox_id is not None for event in events)
    assert len({event.source_outbox_id for event in events}) == len(events)


@pytest.mark.asyncio
async def test_claim_failure_returns_item_to_pending():
    store = InMemoryStore()
    ledger = HashChainLedger()
    await store.enqueue_evidence("tx", EvidenceIntent(event_type="e"))

    class BrokenLedger(HashChainLedger):
        def append(self, *args, **kwargs):
            raise RuntimeError("sink down")

    dispatcher = EvidenceOutboxDispatcher(store, BrokenLedger(), worker_id="d")
    with pytest.raises(RuntimeError, match="sink down"):
        await dispatcher.dispatch_one()
    assert await store.pending_evidence_count() == 1

    healthy = EvidenceOutboxDispatcher(store, ledger, worker_id="healthy")
    event = await healthy.dispatch_one()
    assert event is not None
    assert ledger.count == 1


@pytest.mark.asyncio
async def test_parallel_dispatchers_claim_each_item_once():
    store = InMemoryStore()
    ledger = HashChainLedger()
    for index in range(20):
        await store.enqueue_evidence("tx", EvidenceIntent(event_type="e", payload={"i": index}))
    dispatchers = [
        EvidenceOutboxDispatcher(store, ledger, worker_id=f"d-{index}") for index in range(4)
    ]

    async def worker(dispatcher):
        return await dispatcher.drain()

    results = await asyncio.gather(*(worker(dispatcher) for dispatcher in dispatchers))
    assert sum(len(items) for items in results) == 20
    assert ledger.count == 20
    assert ledger.verify()
    assert await store.pending_evidence_count() == 0
