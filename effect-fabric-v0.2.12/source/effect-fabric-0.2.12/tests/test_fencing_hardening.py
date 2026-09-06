from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from effect_fabric.errors import (
    FencingEpochViolation,
    StaleAttemptOwner,
    StaleFence,
    StaleOutboxClaim,
)
from effect_fabric.models import AttemptState
from effect_fabric.outbox import EvidenceIntent
from effect_fabric.transition_kernel import TransitionCommand, apply_transaction_transition




@pytest.mark.asyncio
async def test_generic_save_cannot_mint_a_fencing_epoch(basic):
    engine, _world, intent, contract, idem, rev = basic
    tx = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=idem,
        reversibility=rev,
    )
    current = await engine.store.get_transaction(tx.transaction_id)
    current.fencing_epoch = 99
    with pytest.raises(FencingEpochViolation):
        await engine.store.save_transaction(current, expected_fence=0)

@pytest.mark.asyncio
async def test_attempt_completion_requires_original_worker_ownership(basic):
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
        worker_id="worker-a",
    )
    current = await engine.store.get_transaction(tx.transaction_id)
    apply_transaction_transition(current, TransitionCommand.MARK_UNKNOWN)

    with pytest.raises(StaleAttemptOwner):
        await engine.store.finalize_attempt_transition(
            current,
            attempt_id=attempt.attempt_id,
            expected_fence=attempt.fencing_epoch,
            worker_id="worker-b",
            attempt_state=AttemptState.UNKNOWN,
        )


@pytest.mark.asyncio
async def test_orphaned_attempt_cannot_finalize_by_learning_new_fence(basic):
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
        worker_id="worker-a",
        lease_seconds=1,
    )
    recovered = await engine.recover_orphaned_started(
        tx.transaction_id,
        now=attempt.lease_expires_at + timedelta(seconds=1),
    )

    with pytest.raises(StaleFence):
        await engine.store.finalize_attempt_transition(
            recovered,
            attempt_id=attempt.attempt_id,
            expected_fence=recovered.fencing_epoch,
            worker_id="worker-a",
            attempt_state=AttemptState.SUCCEEDED,
        )


@pytest.mark.asyncio
async def test_reconciliation_can_settle_orphan_under_current_transaction_fence(basic):
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
        worker_id="worker-a",
        lease_seconds=1,
    )
    recovered = await engine.recover_orphaned_started(
        tx.transaction_id,
        now=attempt.lease_expires_at + timedelta(seconds=1),
    )
    apply_transaction_transition(recovered, TransitionCommand.RECONCILE_HAPPENED)

    await engine.store.finalize_reconciliation_transition(
        recovered,
        attempt_id=attempt.attempt_id,
        expected_fence=recovered.fencing_epoch,
        evidence=EvidenceIntent(event_type="qualification.reconciled_orphan"),
    )
    stored_attempt = await engine.store.get_attempt(attempt.attempt_id)
    assert stored_attempt.state == AttemptState.RECONCILED


@pytest.mark.asyncio
async def test_outbox_claim_token_fences_reused_worker_id(basic):
    engine, _world, *_ = basic
    store = engine.store
    item = await store.enqueue_evidence("tx-claim-token", EvidenceIntent(event_type="event"))
    first = await store.claim_evidence(worker_id="dispatcher", lease_seconds=1)
    assert first is not None and first.claim_token is not None

    store._outbox[item.outbox_id].claim_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    second = await store.claim_evidence(worker_id="dispatcher", lease_seconds=30)
    assert second is not None and second.claim_token is not None
    assert second.claim_token != first.claim_token

    with pytest.raises(StaleOutboxClaim):
        await store.mark_evidence_delivered(
            item.outbox_id,
            worker_id="dispatcher",
            claim_token=first.claim_token,
            event_id="old-event",
        )

    await store.mark_evidence_delivered(
        item.outbox_id,
        worker_id="dispatcher",
        claim_token=second.claim_token,
        event_id="new-event",
    )


def test_postgres_schema_contains_database_level_fencing_guards():
    core = open("migrations/001_core.sql", encoding="utf-8").read()
    upgrade = open("migrations/006_postgres_fencing_claim_tokens.sql", encoding="utf-8").read()
    assert "one_active_attempt_per_transaction" in core
    assert "claim_token UUID" in core
    assert "one_active_attempt_per_transaction" in upgrade
    assert "ADD COLUMN IF NOT EXISTS claim_token UUID" in upgrade
