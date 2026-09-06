import pytest

from effect_fabric.errors import AuthorizationError, CapabilityConsumed
from effect_fabric.models import (
    EffectContract,
    ExecutionState,
    IdempotencyContract,
    Predicate,
    RecoveryPlan,
    RecoveryState,
    ReconciliationStatus,
    ReversibilityClass,
    ReversibilitySpec,
    VerificationState,
)
from effect_fabric.testing import FakeExecutor, FakeVerifier, FakeWorld


@pytest.mark.asyncio
async def test_happy_path_independently_verifies(basic):
    engine, world, intent, contract, idem, rev = basic
    tx = await engine.propose(intent=intent, contract=contract, idempotency=idem, reversibility=rev)
    await engine.prepare(tx.transaction_id, "fake")
    cap = await engine.authorize(tx.transaction_id, "fake")
    result = await engine.execute(tx.transaction_id, cap)
    assert result.execution_state == ExecutionState.RECEIPT_RECORDED
    att = await engine.verify(tx.transaction_id)
    assert att.state == VerificationState.VERIFIED
    assert world.effect_count == 1
    assert engine.ledger.verify()


@pytest.mark.asyncio
async def test_precondition_failure_blocks_before_capability(basic):
    engine, world, intent, contract, idem, rev = basic
    world.state["enabled"] = True
    tx = await engine.propose(intent=intent, contract=contract, idempotency=idem, reversibility=rev)
    with pytest.raises(AuthorizationError):
        await engine.prepare(tx.transaction_id, "fake")
    assert world.effect_count == 0


@pytest.mark.asyncio
async def test_capability_cannot_be_reused(basic):
    engine, world, intent, contract, idem, rev = basic
    tx = await engine.propose(intent=intent, contract=contract, idempotency=idem, reversibility=rev)
    await engine.prepare(tx.transaction_id, "fake")
    cap = await engine.authorize(tx.transaction_id, "fake")
    await engine.execute(tx.transaction_id, cap)
    with pytest.raises(CapabilityConsumed):
        await engine.execute(tx.transaction_id, cap)
    assert world.effect_count == 1


@pytest.mark.asyncio
async def test_ambiguous_effect_enters_unknown_and_never_retries(basic):
    engine, world, intent, contract, idem, rev = basic
    engine.register_executor(
        FakeExecutor(
            world,
            lambda state, intent: state.update(
                enabled=True, version=state["version"] + 1
            ),
            ambiguous_after_effect=True,
        )
    )
    tx = await engine.propose(intent=intent, contract=contract, idempotency=idem, reversibility=rev)
    await engine.prepare(tx.transaction_id, "fake")
    cap = await engine.authorize(tx.transaction_id, "fake")
    result = await engine.execute(tx.transaction_id, cap)
    assert result.execution_state == ExecutionState.UNKNOWN
    assert world.effect_count == 1
    current = await engine.store.get_transaction(tx.transaction_id)
    assert current.execution_state == ExecutionState.UNKNOWN


@pytest.mark.asyncio
async def test_unknown_reconciliation_happened_proceeds_without_second_effect(basic):
    engine, world, intent, contract, idem, rev = basic
    engine.register_executor(
        FakeExecutor(
            world,
            lambda state, intent: state.update(
                enabled=True, version=state["version"] + 1
            ),
            ambiguous_after_effect=True,
        )
    )
    tx = await engine.propose(intent=intent, contract=contract, idempotency=idem, reversibility=rev)
    await engine.prepare(tx.transaction_id, "fake")
    cap = await engine.authorize(tx.transaction_id, "fake")
    await engine.execute(tx.transaction_id, cap)
    status = await engine.reconcile(tx.transaction_id)
    assert status == ReconciliationStatus.HAPPENED
    current = await engine.store.get_transaction(tx.transaction_id)
    assert current.execution_state == ExecutionState.RECONCILED
    assert world.effect_count == 1


@pytest.mark.asyncio
async def test_provider_receipt_does_not_override_verification_mismatch(basic):
    engine, world, intent, contract, idem, rev = basic
    # Executor mutates a different field, yet returns a receipt.
    engine.register_executor(FakeExecutor(world, lambda s, i: s.update(other=True)))
    tx = await engine.propose(intent=intent, contract=contract, idempotency=idem, reversibility=rev)
    await engine.prepare(tx.transaction_id, "fake")
    cap = await engine.authorize(tx.transaction_id, "fake")
    await engine.execute(tx.transaction_id, cap)
    att = await engine.verify(tx.transaction_id)
    assert att.state == VerificationState.MISMATCH


@pytest.mark.asyncio
async def test_verifier_failure_is_inconclusive_not_success(basic):
    engine, world, intent, contract, idem, rev = basic
    engine.register_verifier(FakeVerifier(world, fail=True))
    tx = await engine.propose(intent=intent, contract=contract, idempotency=idem, reversibility=rev)
    await engine.prepare(tx.transaction_id, "fake")
    cap = await engine.authorize(tx.transaction_id, "fake")
    await engine.execute(tx.transaction_id, cap)
    att = await engine.verify(tx.transaction_id)
    assert att.state == VerificationState.INCONCLUSIVE


@pytest.mark.asyncio
async def test_mismatch_marks_compensation_required_when_reversible():
    world = FakeWorld({"enabled": False})
    from effect_fabric.engine import EffectEngine
    from effect_fabric.models import ActionIntent
    engine = EffectEngine()
    engine.register_executor(FakeExecutor(world, lambda s, i: s.update(other=True)))
    engine.register_verifier(FakeVerifier(world))
    intent = ActionIntent(subject="a", operation="demo.enable", resource="r")
    contract = EffectContract(
        resource="r",
        expected=[Predicate(path="enabled", operator="eq", value=True)],
        verifier="fake-verifier",
    )
    rev = ReversibilitySpec(
        classification=ReversibilityClass.COMPENSABLE,
        recovery_operation="demo.disable",
    )
    tx = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=IdempotencyContract(
            mechanism="natural_resource", key="r1"
        ),
        reversibility=rev,
    )
    await engine.prepare(tx.transaction_id, "fake")
    cap = await engine.authorize(tx.transaction_id, "fake")
    await engine.execute(tx.transaction_id, cap)
    await engine.verify(tx.transaction_id)
    current = await engine.store.get_transaction(tx.transaction_id)
    assert current.recovery_state == RecoveryState.COMPENSATION_REQUIRED


@pytest.mark.asyncio
async def test_recovery_is_a_new_action_intent_not_hidden_undo():
    world = FakeWorld({"enabled": False})
    from effect_fabric.engine import EffectEngine
    from effect_fabric.models import ActionIntent
    engine = EffectEngine()
    intent = ActionIntent(subject="a", operation="demo.enable", resource="r")
    contract = EffectContract(resource="r", verifier="fake-verifier")
    restoration = EffectContract(
        resource="r",
        expected=[Predicate(path="enabled", operator="eq", value=False)],
        verifier="fake-verifier",
    )
    engine.register_recovery(
        "demo.enable",
        RecoveryPlan(
            recovery_operation="demo.disable",
            arguments={},
            restoration_contract=restoration,
        ),
    )
    tx = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=IdempotencyContract(mechanism="natural_resource", key="r2"),
        reversibility=ReversibilitySpec(
            classification=ReversibilityClass.COMPENSABLE,
            recovery_operation="demo.disable",
        ),
    )
    recovery_intent, recovery_contract = await engine.build_recovery_intent(tx.transaction_id)
    assert recovery_intent.operation == "demo.disable"
    assert recovery_intent.parent_intent_id == intent.intent_id
    assert recovery_contract == restoration


@pytest.mark.asyncio
async def test_cross_transaction_capability_substitution_rejected(basic):
    engine, world, intent, contract, _idem, rev = basic
    tx_a = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=IdempotencyContract(mechanism="natural_resource", key="sub-a"),
        reversibility=rev,
    )
    tx_b = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=IdempotencyContract(mechanism="natural_resource", key="sub-b"),
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
async def test_reauthorization_invalidates_old_capability(basic):
    engine, world, intent, contract, idem, rev = basic
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
    result = await engine.execute(tx.transaction_id, new_cap)
    assert result.execution_state == ExecutionState.RECEIPT_RECORDED
    assert world.effect_count == 1
