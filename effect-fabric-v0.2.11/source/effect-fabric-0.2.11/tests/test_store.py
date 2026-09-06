import pytest

from effect_fabric.capabilities import CapabilityAuthority
from effect_fabric.errors import (
    CapabilityBindingMismatch,
    CapabilityConsumed,
    CapabilityRevoked,
    DuplicateIdempotencyConflict,
    ImmutableFieldViolation,
    StaleFence,
)
from effect_fabric.models import (
    ActionIntent,
    EffectContract,
    EffectTransaction,
    ExecutionState,
    IdempotencyContract,
    ReversibilityClass,
    ReversibilitySpec,
)
from effect_fabric.store import InMemoryStore


def make_tx(key="k", arg=1):
    intent = ActionIntent(subject="s", operation="o", resource="r", arguments={"arg": arg})
    contract = EffectContract(resource="r", verifier="v")
    return EffectTransaction(
        intent=intent,
        contract=contract,
        idempotency=IdempotencyContract(mechanism="natural_resource", key=key),
        reversibility=ReversibilitySpec(classification=ReversibilityClass.UNKNOWN),
        action_digest=intent.action_digest(contract),
    )


async def authorize_in_store(store: InMemoryStore, tx: EffectTransaction, executor="e"):
    current = await store.get_transaction(tx.transaction_id)
    if current.execution_state == ExecutionState.PLANNED:
        current.execution_state = ExecutionState.PREPARED
        await store.save_transaction(current)
    authority = CapabilityAuthority()
    cap = authority.issue(
        transaction_id=tx.transaction_id,
        subject="s",
        action_digest=tx.action_digest,
        executor=executor,
    )
    await store.authorize_transaction(cap)
    return cap



@pytest.mark.asyncio
async def test_duplicate_same_idempotency_same_action_returns_original():
    store = InMemoryStore()
    first_tx = make_tx()
    second_tx = first_tx.model_copy(update={"transaction_id": "other"})
    first = await store.create_transaction(first_tx)
    second = await store.create_transaction(second_tx)
    assert first.transaction_id == second.transaction_id


@pytest.mark.asyncio
async def test_duplicate_key_changed_action_hard_rejects():
    store = InMemoryStore()
    await store.create_transaction(make_tx(arg=1))
    with pytest.raises(DuplicateIdempotencyConflict):
        await store.create_transaction(make_tx(arg=2))


@pytest.mark.asyncio
async def test_immutable_identity_fields_enforced():
    store = InMemoryStore()
    tx = make_tx()
    await store.create_transaction(tx)
    modified = tx.model_copy(update={"action_digest": "bad"})
    with pytest.raises(ImmutableFieldViolation):
        await store.save_transaction(modified)


@pytest.mark.asyncio
async def test_capability_is_single_use_and_start_is_atomic_reference():
    store = InMemoryStore()
    tx = make_tx()
    await store.create_transaction(tx)
    cap = await authorize_in_store(store, tx)
    attempt = await store.consume_capability_and_start(
        capability_id=cap.capability_id,
        transaction_id=tx.transaction_id,
        executor="e",
    )
    assert attempt.fencing_epoch == 1
    with pytest.raises(CapabilityConsumed):
        await store.consume_capability_and_start(
            capability_id=cap.capability_id,
            transaction_id=tx.transaction_id,
            executor="e",
        )


@pytest.mark.asyncio
async def test_cross_transaction_capability_substitution_rejected_even_same_digest():
    store = InMemoryStore()
    tx_a = make_tx(key="a")
    tx_b = make_tx(key="b")
    await store.create_transaction(tx_a)
    await store.create_transaction(tx_b)
    cap_a = await authorize_in_store(store, tx_a)
    await authorize_in_store(store, tx_b)
    with pytest.raises(CapabilityBindingMismatch):
        await store.consume_capability_and_start(
            capability_id=cap_a.capability_id,
            transaction_id=tx_b.transaction_id,
            executor="e",
        )


@pytest.mark.asyncio
async def test_reauthorization_revokes_prior_capability():
    store = InMemoryStore()
    tx = make_tx()
    await store.create_transaction(tx)
    old_cap = await authorize_in_store(store, tx)
    new_cap = await authorize_in_store(store, tx)
    with pytest.raises(CapabilityRevoked):
        await store.consume_capability_and_start(
            capability_id=old_cap.capability_id,
            transaction_id=tx.transaction_id,
            executor="e",
        )
    attempt = await store.consume_capability_and_start(
        capability_id=new_cap.capability_id,
        transaction_id=tx.transaction_id,
        executor="e",
    )
    assert attempt.fencing_epoch == 1


@pytest.mark.asyncio
async def test_stale_fence_rejected():
    store = InMemoryStore()
    tx = make_tx()
    await store.create_transaction(tx)
    cap = await authorize_in_store(store, tx)
    await store.consume_capability_and_start(
        capability_id=cap.capability_id,
        transaction_id=tx.transaction_id,
        executor="e",
    )
    current = await store.get_transaction(tx.transaction_id)
    with pytest.raises(StaleFence):
        await store.save_transaction(current, expected_fence=0)


@pytest.mark.asyncio
async def test_authorization_binding_is_atomic_in_reference_store():
    store = InMemoryStore()
    tx = make_tx(key="atomic-auth")
    await store.create_transaction(tx)
    current = await store.get_transaction(tx.transaction_id)
    current.execution_state = ExecutionState.PREPARED
    await store.save_transaction(current)
    authority = CapabilityAuthority()
    cap = authority.issue(
        transaction_id=tx.transaction_id,
        subject="s",
        action_digest=tx.action_digest,
        executor="e",
    )
    authorized = await store.authorize_transaction(cap)
    reread = await store.get_transaction(tx.transaction_id)
    assert authorized.capability_id == cap.capability_id
    assert reread.capability_id == cap.capability_id
    assert reread.execution_state == ExecutionState.AUTHORIZED
