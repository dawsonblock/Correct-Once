import os
from pathlib import Path

import pytest
import pytest_asyncio

psycopg = pytest.importorskip("psycopg")

from effect_fabric.engine import EffectEngine
from effect_fabric.errors import AuthorizationError, CapabilityConsumed
from effect_fabric.models import (
    ActionIntent,
    EffectContract,
    IdempotencyContract,
    ReversibilityClass,
    ReversibilitySpec,
)
from effect_fabric.postgres import PostgresStore
from effect_fabric.testing import FakeExecutor, FakeVerifier, FakeWorld

DSN = os.getenv("EFFECT_FABRIC_TEST_POSTGRES_DSN")
pytestmark = pytest.mark.skipif(not DSN, reason="EFFECT_FABRIC_TEST_POSTGRES_DSN not set")


@pytest_asyncio.fixture
async def pg_store():
    conn = await psycopg.AsyncConnection.connect(DSN)
    await conn.execute("DROP TABLE IF EXISTS effect_evidence_outbox CASCADE")
    await conn.execute("DROP TABLE IF EXISTS ledger_anchor_mirrors CASCADE")
    await conn.execute("DROP TABLE IF EXISTS evidence_ledger_state CASCADE")
    await conn.execute("DROP TABLE IF EXISTS effect_events CASCADE")
    await conn.execute("DROP TABLE IF EXISTS execution_attempts CASCADE")
    await conn.execute("DROP TABLE IF EXISTS execution_capabilities CASCADE")
    await conn.execute("DROP TABLE IF EXISTS effect_transactions CASCADE")
    for migration in sorted(Path("migrations").glob("*.sql")):
        await conn.execute(migration.read_text(encoding="utf-8"))
    await conn.commit()
    store = PostgresStore(conn)
    try:
        yield store
    finally:
        await store.close()


def make_engine(store):
    world = FakeWorld({"enabled": False, "version": 1})

    def mutation(state, intent):
        del intent
        state["enabled"] = True
        state["version"] += 1

    engine = EffectEngine(store=store)
    engine.register_executor(FakeExecutor(world, mutation))
    engine.register_verifier(FakeVerifier(world))
    return engine, world


def make_inputs(key):
    intent = ActionIntent(
        subject="agent-a",
        operation="demo.enable",
        resource="demo://feature",
        arguments={"mode": "safe"},
    )
    contract = EffectContract(resource=intent.resource, verifier="fake-verifier")
    idem = IdempotencyContract(mechanism="natural_resource", key=key)
    rev = ReversibilitySpec(classification=ReversibilityClass.UNKNOWN)
    return intent, contract, idem, rev


@pytest.mark.asyncio
async def test_postgres_rejects_same_digest_cross_transaction_capability(pg_store):
    engine, world = make_engine(pg_store)
    intent, contract, idem_a, rev = make_inputs("pg-a")
    _, _, idem_b, _ = make_inputs("pg-b")
    tx_a = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=idem_a,
        reversibility=rev,
    )
    tx_b = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=idem_b,
        reversibility=rev,
    )
    await engine.prepare(tx_a.transaction_id, "fake")
    await engine.prepare(tx_b.transaction_id, "fake")
    cap_a = await engine.authorize(tx_a.transaction_id, "fake")
    await engine.authorize(tx_b.transaction_id, "fake")

    with pytest.raises(AuthorizationError):
        await engine.execute(tx_b.transaction_id, cap_a)
    assert world.effect_count == 0


@pytest.mark.asyncio
async def test_postgres_reauthorization_revokes_old_capability(pg_store):
    engine, world = make_engine(pg_store)
    intent, contract, idem, rev = make_inputs("pg-reauth")
    tx = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=idem,
        reversibility=rev,
    )
    await engine.prepare(tx.transaction_id, "fake")
    old_cap = await engine.authorize(tx.transaction_id, "fake")
    new_cap = await engine.authorize(tx.transaction_id, "fake")

    with pytest.raises(AuthorizationError):
        await engine.execute(tx.transaction_id, old_cap)
    await engine.execute(tx.transaction_id, new_cap)
    assert world.effect_count == 1


@pytest.mark.asyncio
async def test_postgres_capability_is_single_use(pg_store):
    engine, _ = make_engine(pg_store)
    intent, contract, idem, rev = make_inputs("pg-single")
    tx = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=idem,
        reversibility=rev,
    )
    await engine.prepare(tx.transaction_id, "fake")
    cap = await engine.authorize(tx.transaction_id, "fake")
    await engine.execute(tx.transaction_id, cap)
    with pytest.raises(CapabilityConsumed):
        await pg_store.consume_capability_and_start(
            capability_id=cap.capability_id,
            transaction_id=tx.transaction_id,
            executor="fake",
        )


@pytest.mark.asyncio
async def test_postgres_authorization_and_transaction_reference_are_atomic(pg_store):
    engine, _world = make_engine(pg_store)
    intent, contract, idem, rev = make_inputs("pg-atomic-auth")
    tx = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=idem,
        reversibility=rev,
    )
    await engine.prepare(tx.transaction_id, "fake")
    cap = await engine.authorize(tx.transaction_id, "fake")
    current = await pg_store.get_transaction(tx.transaction_id)
    assert current.capability_id == cap.capability_id
    assert current.execution_state.value == "authorized"


@pytest.mark.asyncio
async def test_postgres_expired_started_attempt_is_fenced_to_unknown(pg_store):
    from datetime import timedelta

    from effect_fabric.errors import StaleFence
    from effect_fabric.models import ExecutionState

    engine, _world = make_engine(pg_store)
    intent, contract, idem, rev = make_inputs("pg-orphan")
    tx = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=idem,
        reversibility=rev,
    )
    await engine.prepare(tx.transaction_id, "fake")
    cap = await engine.authorize(tx.transaction_id, "fake")
    attempt = await pg_store.consume_capability_and_start(
        capability_id=cap.capability_id,
        transaction_id=tx.transaction_id,
        executor="fake",
        worker_id="worker-a",
        lease_seconds=1,
    )
    recovered = await engine.recover_orphaned_started(
        tx.transaction_id,
        now=attempt.lease_expires_at + timedelta(seconds=1),
    )
    assert recovered.execution_state == ExecutionState.UNKNOWN
    assert recovered.fencing_epoch == attempt.fencing_epoch + 1
    late = await pg_store.get_transaction(tx.transaction_id)
    late.execution_state = ExecutionState.RECEIPT_RECORDED
    with pytest.raises(StaleFence):
        await pg_store.save_transaction(late, expected_fence=attempt.fencing_epoch)


@pytest.mark.asyncio
async def test_postgres_parallel_capability_consumption_has_one_winner(pg_store):
    import asyncio

    from effect_fabric.errors import CapabilityBindingMismatch, CapabilityConsumed

    engine, _world = make_engine(pg_store)
    intent, contract, idem, rev = make_inputs("pg-parallel-consume")
    tx = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=idem,
        reversibility=rev,
    )
    await engine.prepare(tx.transaction_id, "fake")
    cap = await engine.authorize(tx.transaction_id, "fake")

    conn2 = await psycopg.AsyncConnection.connect(DSN, row_factory=psycopg.rows.dict_row)
    store2 = PostgresStore(conn2)

    async def consume(store, worker):
        try:
            return await store.consume_capability_and_start(
                capability_id=cap.capability_id,
                transaction_id=tx.transaction_id,
                executor="fake",
                worker_id=worker,
            )
        except (CapabilityConsumed, CapabilityBindingMismatch):
            return None

    try:
        results = await asyncio.gather(consume(pg_store, "a"), consume(store2, "b"))
    finally:
        await store2.close()
    assert len([item for item in results if item is not None]) == 1


@pytest.mark.asyncio
async def test_postgres_evidence_chain_persists_across_connection_restart(pg_store, tmp_path):
    from effect_fabric.anchors import (
        AnchorKeyring,
        AnchorSigner,
        FileAnchorStore,
        checkpoint_postgres_ledger,
        verify_anchor_chain,
        verify_async_ledger_against_anchor,
    )
    from effect_fabric.postgres_evidence import PostgresEvidenceLedger

    ledger = PostgresEvidenceLedger(pg_store.conn)
    engine, _world = make_engine(pg_store)
    engine.ledger = ledger
    intent, contract, idem, rev = make_inputs("pg-evidence-restart")
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
    assert await ledger.verify()
    count_before = await ledger.count()
    root_before = await ledger.root()
    assert count_before >= 5

    signer = AnchorSigner(key_id="pg-test-key")
    keyring = AnchorKeyring({signer.key_id: signer.public})
    anchor_store = FileAnchorStore(tmp_path / "external" / "anchors.jsonl")
    anchor = await checkpoint_postgres_ledger(
        ledger,
        signer,
        anchor_store,
        external_location=str(anchor_store.path),
    )
    assert verify_anchor_chain(anchor_store.load(), keyring)
    assert await verify_async_ledger_against_anchor(ledger, anchor)

    conn2 = await psycopg.AsyncConnection.connect(DSN, row_factory=psycopg.rows.dict_row)
    ledger2 = PostgresEvidenceLedger(conn2)
    try:
        assert await ledger2.verify()
        assert await ledger2.count() == count_before
        assert await ledger2.root() == root_before
        assert await verify_async_ledger_against_anchor(ledger2, anchor)
    finally:
        await conn2.close()


@pytest.mark.asyncio
async def test_postgres_evidence_parallel_append_is_one_valid_chain(pg_store):
    import asyncio

    from effect_fabric.postgres_evidence import PostgresEvidenceLedger

    engine, _world = make_engine(pg_store)
    intent, contract, idem, rev = make_inputs("pg-evidence-parallel")
    tx = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=idem,
        reversibility=rev,
    )
    ledger1 = PostgresEvidenceLedger(pg_store.conn)
    conn2 = await psycopg.AsyncConnection.connect(DSN, row_factory=psycopg.rows.dict_row)
    ledger2 = PostgresEvidenceLedger(conn2)

    async def append(index):
        ledger = ledger1 if index % 2 == 0 else ledger2
        return await ledger.append(tx.transaction_id, "qualification.parallel", {"i": index})

    try:
        events = await asyncio.gather(*(append(index) for index in range(12)))
        assert len({event.sequence for event in events}) == 12
        assert await ledger1.verify()
        assert await ledger2.verify()
        assert await ledger1.count() == 12
    finally:
        await conn2.close()

@pytest.mark.asyncio
async def test_postgres_started_transition_and_outbox_intent_commit_together(pg_store):
    from effect_fabric.faults import FaultInjector, SimulatedCrash
    from effect_fabric.models import ExecutionState

    engine, world = make_engine(pg_store)
    engine.faults = FaultInjector(armed={"after_started_transition_committed"})
    intent, contract, idem, rev = make_inputs("pg-atomic-evidence-start")
    tx = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=idem,
        reversibility=rev,
    )
    await engine.prepare(tx.transaction_id, "fake")
    cap = await engine.authorize(tx.transaction_id, "fake")

    with pytest.raises(SimulatedCrash):
        await engine.execute(tx.transaction_id, cap)

    current = await pg_store.get_transaction(tx.transaction_id)
    assert current.execution_state == ExecutionState.STARTED
    assert world.effect_count == 0
    row = await (
        await pg_store.conn.execute(
            """SELECT event_type, status FROM effect_evidence_outbox
               WHERE transaction_id=%s AND event_type='effect.started'""",
            (tx.transaction_id,),
        )
    ).fetchone()
    assert row is not None
    assert row["status"] == "pending"


@pytest.mark.asyncio
async def test_postgres_outbox_redelivery_does_not_duplicate_chain_event(pg_store):
    from datetime import timedelta

    from effect_fabric.faults import SimulatedCrash
    from effect_fabric.outbox import EvidenceIntent, EvidenceOutboxDispatcher
    from effect_fabric.postgres_evidence import PostgresEvidenceLedger

    engine, _world = make_engine(pg_store)
    intent, contract, idem, rev = make_inputs("pg-outbox-redelivery")
    tx = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=idem,
        reversibility=rev,
    )
    item = await pg_store.enqueue_evidence(
        tx.transaction_id,
        EvidenceIntent(event_type="qualification.outbox", payload={"x": 1}),
    )
    ledger = PostgresEvidenceLedger(pg_store.conn)
    dispatcher = EvidenceOutboxDispatcher(pg_store, ledger, worker_id="d1", lease_seconds=1)

    def crash(_item, _event):
        raise SimulatedCrash("after_evidence_append_before_ack")

    with pytest.raises(SimulatedCrash):
        await dispatcher.dispatch_one(after_append_hook=crash)
    count = await ledger.count()
    assert count == 1

    await pg_store.conn.execute(
        """UPDATE effect_evidence_outbox
           SET claim_expires_at=now() - interval '1 second'
           WHERE outbox_id=%s""",
        (item.outbox_id,),
    )
    await pg_store.conn.commit()
    replacement = EvidenceOutboxDispatcher(pg_store, ledger, worker_id="d2")
    event = await replacement.dispatch_one()
    assert event is not None
    assert event.source_outbox_id == item.outbox_id
    assert await ledger.count() == count

@pytest.mark.asyncio
async def test_postgres_os_kill_after_started_commit_preserves_outbox_intent(pg_store):
    import subprocess
    import sys

    from effect_fabric.models import ExecutionState

    engine, world = make_engine(pg_store)
    intent, contract, idem, rev = make_inputs("pg-process-kill-start")
    tx = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=idem,
        reversibility=rev,
    )
    await engine.prepare(tx.transaction_id, "fake")
    cap = await engine.authorize(tx.transaction_id, "fake")

    completed = subprocess.run(
        [
            sys.executable,
            "tests/helpers/postgres_kill_worker.py",
            "start",
            "--dsn",
            DSN,
            "--transaction-id",
            tx.transaction_id,
            "--capability-id",
            cap.capability_id,
            "--executor",
            "fake",
        ],
        check=False,
    )
    assert completed.returncode == 91
    current = await pg_store.get_transaction(tx.transaction_id)
    assert current.execution_state == ExecutionState.STARTED
    assert world.effect_count == 0
    row = await (
        await pg_store.conn.execute(
            """SELECT status FROM effect_evidence_outbox
               WHERE transaction_id=%s AND event_type='qualification.process_kill_started'""",
            (tx.transaction_id,),
        )
    ).fetchone()
    assert row is not None and row["status"] == "pending"


@pytest.mark.asyncio
async def test_postgres_os_kill_after_ledger_append_redelivers_without_duplicate(pg_store):
    import subprocess
    import sys

    from effect_fabric.outbox import EvidenceIntent, EvidenceOutboxDispatcher
    from effect_fabric.postgres_evidence import PostgresEvidenceLedger

    engine, _world = make_engine(pg_store)
    intent, contract, idem, rev = make_inputs("pg-process-kill-dispatch")
    tx = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=idem,
        reversibility=rev,
    )
    item = await pg_store.enqueue_evidence(
        tx.transaction_id,
        EvidenceIntent(event_type="qualification.process_kill_dispatch"),
    )
    completed = subprocess.run(
        [
            sys.executable,
            "tests/helpers/postgres_kill_worker.py",
            "dispatch",
            "--dsn",
            DSN,
        ],
        check=False,
    )
    assert completed.returncode == 92

    ledger = PostgresEvidenceLedger(pg_store.conn)
    before = await ledger.count()
    assert before == 1
    await pg_store.conn.execute(
        """UPDATE effect_evidence_outbox
           SET claim_expires_at=now() - interval '1 second'
           WHERE outbox_id=%s""",
        (item.outbox_id,),
    )
    await pg_store.conn.commit()
    replacement = EvidenceOutboxDispatcher(pg_store, ledger, worker_id="replacement")
    event = await replacement.dispatch_one()
    assert event is not None
    assert event.source_outbox_id == item.outbox_id
    assert await ledger.count() == before
