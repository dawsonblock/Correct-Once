from __future__ import annotations

import asyncio
import os
import subprocess
import sys
from datetime import timedelta
from pathlib import Path

import pytest
import pytest_asyncio

psycopg = pytest.importorskip("psycopg")
DSN = os.getenv("EFFECT_FABRIC_TEST_POSTGRES_DSN")
pytestmark = pytest.mark.skipif(not DSN, reason="EFFECT_FABRIC_TEST_POSTGRES_DSN not set")

from effect_fabric.engine import EffectEngine
from effect_fabric.errors import (
    CapabilityBindingMismatch,
    CapabilityConsumed,
    StaleFence,
    StaleOutboxClaim,
)
from effect_fabric.models import (
    ActionIntent,
    AttemptState,
    EffectContract,
    ExecutionState,
    IdempotencyContract,
    ReversibilityClass,
    ReversibilitySpec,
)
from effect_fabric.outbox import EvidenceIntent, EvidenceOutboxDispatcher
from effect_fabric.postgres import PostgresStore
from effect_fabric.postgres_evidence import PostgresEvidenceLedger
from effect_fabric.testing import FakeExecutor, FakeVerifier, FakeWorld
from effect_fabric.transition_kernel import TransitionCommand, apply_transaction_transition


async def _reset_schema(conn) -> None:
    await conn.execute("DROP TABLE IF EXISTS qualification_external_effects CASCADE")
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


@pytest_asyncio.fixture
async def stores():
    conn1 = await psycopg.AsyncConnection.connect(DSN, row_factory=psycopg.rows.dict_row)
    conn2 = await psycopg.AsyncConnection.connect(DSN, row_factory=psycopg.rows.dict_row)
    await _reset_schema(conn1)
    try:
        yield PostgresStore(conn1), PostgresStore(conn2)
    finally:
        await conn1.close()
        await conn2.close()


def make_engine(store: PostgresStore) -> EffectEngine:
    world = FakeWorld({"enabled": False, "version": 1})

    def mutation(state, intent):
        del intent
        state["enabled"] = True
        state["version"] += 1

    engine = EffectEngine(store=store)
    engine.register_executor(FakeExecutor(world, mutation))
    engine.register_verifier(FakeVerifier(world))
    return engine


def make_inputs(key: str):
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


async def prepare_authorized(engine: EffectEngine, key: str):
    intent, contract, idem, rev = make_inputs(key)
    tx = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=idem,
        reversibility=rev,
    )
    await engine.prepare(tx.transaction_id, "fake")
    cap = await engine.authorize(tx.transaction_id, "fake")
    return tx, cap


@pytest.mark.asyncio
async def test_two_dispatchers_claim_distinct_outbox_rows(stores):
    store1, store2 = stores
    await store1.enqueue_evidence(
        "00000000-0000-0000-0000-000000000001", EvidenceIntent(event_type="a")
    )
    await store1.enqueue_evidence(
        "00000000-0000-0000-0000-000000000002", EvidenceIntent(event_type="b")
    )
    first, second = await asyncio.gather(
        store1.claim_evidence(worker_id="one"),
        store2.claim_evidence(worker_id="two"),
    )
    assert first is not None and second is not None
    assert first.outbox_id != second.outbox_id
    assert first.claim_token and second.claim_token
    assert first.claim_token != second.claim_token


@pytest.mark.asyncio
async def test_rollback_does_not_publish_partial_outbox_row(stores):
    store1, store2 = stores
    try:
        async with store1.conn.transaction():
            await store1.conn.execute(
                """INSERT INTO effect_evidence_outbox
                   (outbox_id, transaction_id, event_type, payload, status, created_at, attempts)
                   VALUES (gen_random_uuid(), %s, 'rollback-test', '{}'::jsonb,
                           'pending', now(), 0)""",
                ("00000000-0000-0000-0000-000000000003",),
            )
            raise RuntimeError("force rollback")
    except RuntimeError:
        pass
    row = await (
        await store2.conn.execute(
            "SELECT count(*) AS count FROM effect_evidence_outbox WHERE event_type='rollback-test'"
        )
    ).fetchone()
    assert int(row["count"]) == 0


@pytest.mark.asyncio
async def test_parallel_capability_consumption_has_exactly_one_owner(stores):
    store1, store2 = stores
    engine = make_engine(store1)
    tx, cap = await prepare_authorized(engine, "matrix-parallel-owner")

    async def consume(store: PostgresStore, worker: str):
        try:
            return await store.consume_capability_and_start(
                capability_id=cap.capability_id,
                transaction_id=tx.transaction_id,
                executor="fake",
                worker_id=worker,
                lease_seconds=30,
            )
        except (CapabilityConsumed, CapabilityBindingMismatch):
            return None

    results = await asyncio.gather(consume(store1, "worker-a"), consume(store2, "worker-b"))
    winners = [result for result in results if result is not None]
    assert len(winners) == 1
    row = await (
        await store1.conn.execute(
            """SELECT count(*) AS count FROM execution_attempts
               WHERE transaction_id=%s AND state='active'""",
            (tx.transaction_id,),
        )
    ).fetchone()
    assert int(row["count"]) == 1


@pytest.mark.asyncio
async def test_orphan_takeover_fences_old_attempt_even_if_old_worker_learns_new_epoch(stores):
    store1, _store2 = stores
    engine = make_engine(store1)
    tx, cap = await prepare_authorized(engine, "matrix-stale-finalize")
    attempt = await store1.consume_capability_and_start(
        capability_id=cap.capability_id,
        transaction_id=tx.transaction_id,
        executor="fake",
        worker_id="old-worker",
        lease_seconds=1,
    )
    recovered = await store1.recover_orphaned_started(
        tx.transaction_id,
        now=attempt.lease_expires_at + timedelta(seconds=1),
    )
    assert recovered.execution_state == ExecutionState.UNKNOWN

    with pytest.raises(StaleFence):
        await store1.finalize_attempt_transition(
            recovered,
            attempt_id=attempt.attempt_id,
            expected_fence=recovered.fencing_epoch,
            worker_id="old-worker",
            attempt_state=AttemptState.SUCCEEDED,
        )


@pytest.mark.asyncio
async def test_orphan_reconciliation_is_separate_current_fence_operation(stores):
    store1, _store2 = stores
    engine = make_engine(store1)
    tx, cap = await prepare_authorized(engine, "matrix-orphan-reconcile")
    attempt = await store1.consume_capability_and_start(
        capability_id=cap.capability_id,
        transaction_id=tx.transaction_id,
        executor="fake",
        worker_id="old-worker",
        lease_seconds=1,
    )
    recovered = await store1.recover_orphaned_started(
        tx.transaction_id,
        now=attempt.lease_expires_at + timedelta(seconds=1),
    )
    apply_transaction_transition(recovered, TransitionCommand.RECONCILE_HAPPENED)
    await store1.finalize_reconciliation_transition(
        recovered,
        attempt_id=attempt.attempt_id,
        expected_fence=recovered.fencing_epoch,
        evidence=EvidenceIntent(event_type="qualification.orphan_reconciled"),
    )
    stored_attempt = await store1.get_attempt(attempt.attempt_id)
    assert stored_attempt.state == AttemptState.RECONCILED


@pytest.mark.asyncio
async def test_reused_worker_id_cannot_ack_with_superseded_claim_token(stores):
    store1, store2 = stores
    engine = make_engine(store1)
    intent, contract, idem, rev = make_inputs("matrix-claim-token")
    tx = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=idem,
        reversibility=rev,
    )
    item = await store1.enqueue_evidence(tx.transaction_id, EvidenceIntent(event_type="token"))
    first = await store1.claim_evidence(worker_id="same-worker", lease_seconds=1)
    assert first is not None and first.claim_token is not None
    await store1.conn.execute(
        "UPDATE effect_evidence_outbox "
        "SET claim_expires_at=now()-interval '1 second' WHERE outbox_id=%s",
        (item.outbox_id,),
    )
    await store1.conn.commit()
    second = await store2.claim_evidence(worker_id="same-worker", lease_seconds=30)
    assert second is not None and second.claim_token is not None
    assert second.claim_token != first.claim_token

    with pytest.raises(StaleOutboxClaim):
        await store1.mark_evidence_delivered(
            item.outbox_id,
            worker_id="same-worker",
            claim_token=first.claim_token,
            event_id="stale-event",
        )


@pytest.mark.asyncio
async def test_sigkill_after_started_commit_leaves_started_and_durable_evidence(stores):
    store1, _store2 = stores
    engine = make_engine(store1)
    tx, cap = await prepare_authorized(engine, "matrix-kill-start")
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
        env={**os.environ, "PYTHONPATH": str(Path("src").resolve())},
    )
    assert completed.returncode == 91
    current = await store1.get_transaction(tx.transaction_id)
    assert current.execution_state == ExecutionState.STARTED
    row = await (
        await store1.conn.execute(
            """SELECT status FROM effect_evidence_outbox
               WHERE transaction_id=%s AND event_type='qualification.process_kill_started'""",
            (tx.transaction_id,),
        )
    ).fetchone()
    assert row is not None and row["status"] == "pending"


@pytest.mark.asyncio
async def test_sigkill_after_external_effect_forces_orphan_reconciliation(stores):
    store1, _store2 = stores
    engine = make_engine(store1)
    tx, cap = await prepare_authorized(engine, "matrix-kill-ambiguous")
    completed = subprocess.run(
        [
            sys.executable,
            "tests/helpers/postgres_kill_worker.py",
            "ambiguous-effect",
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
        env={**os.environ, "PYTHONPATH": str(Path("src").resolve())},
    )
    assert completed.returncode == 93
    current = await store1.get_transaction(tx.transaction_id)
    assert current.execution_state == ExecutionState.STARTED
    marker = await (
        await store1.conn.execute(
            "SELECT attempt_id FROM qualification_external_effects WHERE transaction_id=%s",
            (tx.transaction_id,),
        )
    ).fetchone()
    assert marker is not None
    attempt = await store1.get_attempt(current.latest_attempt_id)
    recovered = await store1.recover_orphaned_started(
        tx.transaction_id,
        now=attempt.lease_expires_at + timedelta(seconds=1),
    )
    assert recovered.execution_state == ExecutionState.UNKNOWN
    assert recovered.fencing_epoch == attempt.fencing_epoch + 1


@pytest.mark.asyncio
async def test_sigkill_after_receipt_commit_preserves_receipt_and_evidence(stores):
    store1, _store2 = stores
    engine = make_engine(store1)
    tx, cap = await prepare_authorized(engine, "matrix-kill-receipt")
    completed = subprocess.run(
        [
            sys.executable,
            "tests/helpers/postgres_kill_worker.py",
            "receipt",
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
        env={**os.environ, "PYTHONPATH": str(Path("src").resolve())},
    )
    assert completed.returncode == 94
    current = await store1.get_transaction(tx.transaction_id)
    assert current.execution_state == ExecutionState.RECEIPT_RECORDED
    assert current.receipt is not None
    row = await (
        await store1.conn.execute(
            """SELECT status FROM effect_evidence_outbox
               WHERE transaction_id=%s AND event_type='qualification.process_kill_receipt'""",
            (tx.transaction_id,),
        )
    ).fetchone()
    assert row is not None and row["status"] == "pending"


@pytest.mark.asyncio
async def test_sigkill_after_outbox_claim_reclaims_with_new_token(stores):
    store1, _store2 = stores
    engine = make_engine(store1)
    intent, contract, idem, rev = make_inputs("matrix-kill-claim")
    tx = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=idem,
        reversibility=rev,
    )
    item = await store1.enqueue_evidence(
        tx.transaction_id,
        EvidenceIntent(event_type="qualification.process_kill_claim"),
    )
    completed = subprocess.run(
        [sys.executable, "tests/helpers/postgres_kill_worker.py", "claim", "--dsn", DSN],
        check=False,
        env={**os.environ, "PYTHONPATH": str(Path("src").resolve())},
    )
    assert completed.returncode == 95
    before = await (
        await store1.conn.execute(
            "SELECT claim_token, attempts FROM effect_evidence_outbox WHERE outbox_id=%s",
            (item.outbox_id,),
        )
    ).fetchone()
    assert before["claim_token"] is not None
    await store1.conn.execute(
        "UPDATE effect_evidence_outbox "
        "SET claim_expires_at=now()-interval '1 second' WHERE outbox_id=%s",
        (item.outbox_id,),
    )
    await store1.conn.commit()
    replacement = await store1.claim_evidence(worker_id="replacement", lease_seconds=30)
    assert replacement is not None
    assert str(before["claim_token"]) != replacement.claim_token
    assert replacement.attempts == int(before["attempts"]) + 1


@pytest.mark.asyncio
async def test_sigkill_after_ledger_append_redelivers_without_duplicate(stores):
    store1, _store2 = stores
    engine = make_engine(store1)
    intent, contract, idem, rev = make_inputs("matrix-kill-dispatch")
    tx = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=idem,
        reversibility=rev,
    )
    item = await store1.enqueue_evidence(
        tx.transaction_id,
        EvidenceIntent(event_type="qualification.process_kill_dispatch"),
    )
    completed = subprocess.run(
        [sys.executable, "tests/helpers/postgres_kill_worker.py", "dispatch", "--dsn", DSN],
        check=False,
        env={**os.environ, "PYTHONPATH": str(Path("src").resolve())},
    )
    assert completed.returncode == 92
    ledger = PostgresEvidenceLedger(store1.conn)
    before = await ledger.count()
    assert before == 1
    await store1.conn.execute(
        "UPDATE effect_evidence_outbox "
        "SET claim_expires_at=now()-interval '1 second' WHERE outbox_id=%s",
        (item.outbox_id,),
    )
    await store1.conn.commit()
    replacement = EvidenceOutboxDispatcher(store1, ledger, worker_id="replacement")
    event = await replacement.dispatch_one()
    assert event is not None
    assert event.source_outbox_id == item.outbox_id
    assert await ledger.count() == before
