from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from cryptography.exceptions import InvalidSignature

from effect_fabric.engine import EffectEngine
from effect_fabric.errors import AuthorizationError
from effect_fabric.identity import WorkloadAuthority, WorkloadSigner, WorkloadVerifier
from effect_fabric.testing import FakeExecutor, FakeVerifier


def test_workload_credential_and_assertion_round_trip():
    authority = WorkloadAuthority(key_id="authority-a")
    signer = WorkloadSigner.enroll(
        authority,
        worker_id="worker-a",
        subject="agent-a",
        environment_id="test",
        release_id="0.2.11",
    )
    verifier = WorkloadVerifier.from_authority(authority)
    assertion = signer.sign(
        kind="effect.execute.start",
        transaction_id="tx-1",
        action_digest="digest-1",
        executor="fake",
    )
    verifier.verify_assertion(
        assertion,
        expected_kind="effect.execute.start",
        expected_transaction_id="tx-1",
        expected_action_digest="digest-1",
        expected_executor="fake",
        expected_worker_id="worker-a",
        expected_subject="agent-a",
        expected_environment_id="test",
        expected_release_id="0.2.11",
    )


def test_tampered_workload_assertion_fails():
    authority = WorkloadAuthority()
    signer = WorkloadSigner.enroll(
        authority,
        worker_id="worker-a",
        subject="agent-a",
        environment_id="test",
        release_id="0.2.11",
    )
    verifier = WorkloadVerifier.from_authority(authority)
    assertion = signer.sign(
        kind="effect.execute.start",
        transaction_id="tx-1",
        action_digest="digest-1",
        executor="fake",
    )
    tampered = assertion.model_copy(update={"transaction_id": "tx-evil"})
    with pytest.raises((InvalidSignature, ValueError)):
        verifier.verify_assertion(tampered)


def test_expired_workload_credential_fails():
    authority = WorkloadAuthority()
    signer = WorkloadSigner.enroll(
        authority,
        worker_id="worker-a",
        subject="agent-a",
        environment_id="test",
        release_id="0.2.11",
        ttl_seconds=1,
    )
    verifier = WorkloadVerifier.from_authority(authority)
    assertion = signer.sign(
        kind="effect.execute.start",
        transaction_id="tx-1",
        action_digest="digest-1",
        executor="fake",
    )
    future = datetime.now(UTC) + timedelta(seconds=2)
    with pytest.raises(ValueError, match="expired"):
        verifier.verify_assertion(assertion, now=future)


@pytest.mark.asyncio
async def test_engine_requires_and_records_workload_identity(basic):
    _old_engine, world, intent, contract, idem, rev = basic
    authority = WorkloadAuthority(key_id="runtime-authority")
    verifier = WorkloadVerifier.from_authority(authority)
    signer = WorkloadSigner.enroll(
        authority,
        worker_id="worker-a",
        subject=intent.subject,
        environment_id="qualification",
        release_id="0.2.11",
    )
    engine = EffectEngine(
        workload_verifier=verifier,
        require_workload_identity=True,
        environment_id="qualification",
        release_id="0.2.11",
    )
    engine.register_executor(FakeExecutor(world, lambda state, _intent: state.update(enabled=True)))
    engine.register_verifier(FakeVerifier(world))

    tx = await engine.propose(intent=intent, contract=contract, idempotency=idem, reversibility=rev)
    await engine.prepare(tx.transaction_id, "fake")
    cap = await engine.authorize(tx.transaction_id, "fake")

    with pytest.raises(AuthorizationError, match="workload identity"):
        await engine.execute(tx.transaction_id, cap, worker_id="worker-a")

    result = await engine.execute(
        tx.transaction_id,
        cap,
        worker_id="worker-a",
        workload_signer=signer,
    )
    attempt = await engine.store.get_attempt(result.latest_attempt_id)
    assert attempt.workload_credential_id == signer.credential.credential_id
    assert attempt.workload_identity_digest == signer.credential.digest
    events = engine.ledger.events()
    started = next(event for event in events if event.event_type == "effect.started")
    assert started.payload["workload_credential_id"] == signer.credential.credential_id
    assert started.payload["workload_assertion"]["worker_id"] == "worker-a"
    assert any(event.event_type == "effect.attempt_identity_bound" for event in events)
    receipt = next(event for event in events if event.event_type == "effect.receipt_recorded")
    assert receipt.payload["workload_assertion"]["attempt_id"] == attempt.attempt_id


@pytest.mark.asyncio
async def test_engine_rejects_wrong_release_identity(basic):
    _old_engine, world, intent, contract, idem, rev = basic
    authority = WorkloadAuthority()
    verifier = WorkloadVerifier.from_authority(authority)
    signer = WorkloadSigner.enroll(
        authority,
        worker_id="worker-a",
        subject=intent.subject,
        environment_id="qualification",
        release_id="0.2.10",
    )
    engine = EffectEngine(
        workload_verifier=verifier,
        require_workload_identity=True,
        environment_id="qualification",
        release_id="0.2.11",
    )
    engine.register_executor(FakeExecutor(world, lambda state, _intent: state.update(enabled=True)))
    tx = await engine.propose(intent=intent, contract=contract, idempotency=idem, reversibility=rev)
    await engine.prepare(tx.transaction_id, "fake")
    cap = await engine.authorize(tx.transaction_id, "fake")
    with pytest.raises(AuthorizationError):
        await engine.execute(
            tx.transaction_id,
            cap,
            worker_id="worker-a",
            workload_signer=signer,
        )
