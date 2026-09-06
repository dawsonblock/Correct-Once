from __future__ import annotations

import json
from pathlib import Path

import pytest

from effect_fabric._generated_transition_table import COMMANDS, SPEC_SHA256, TERMINAL_STATES
from effect_fabric.errors import InvalidTransition
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
from effect_fabric.transition_kernel import (
    TransitionCommand,
    apply_transaction_transition,
    assert_legal_execution_edge,
    decide_execution_transition,
)

ROOT = Path(__file__).resolve().parents[1]


def make_tx() -> EffectTransaction:
    intent = ActionIntent(subject="s", operation="o", resource="r")
    contract = EffectContract(resource="r", verifier="v")
    return EffectTransaction(
        intent=intent,
        contract=contract,
        idempotency=IdempotencyContract(mechanism="natural_resource", key="k"),
        reversibility=ReversibilitySpec(classification=ReversibilityClass.UNKNOWN),
        action_digest=intent.action_digest(contract),
    )


def test_spec_covers_every_runtime_execution_state() -> None:
    spec = json.loads((ROOT / "spec/effect-transition-v1.json").read_text())
    assert set(spec["states"]) == {state.value for state in ExecutionState}
    import hashlib

    observed = hashlib.sha256(
        (ROOT / "spec/effect-transition-v1.json").read_bytes()
    ).hexdigest()
    assert observed == SPEC_SHA256


def test_every_declared_command_has_a_valid_decision() -> None:
    assert set(COMMANDS) == {command.value for command in TransitionCommand}
    for command, rule in COMMANDS.items():
        for source in rule["sources"]:
            result = decide_execution_transition(source, command)
            assert result.accepted
            assert result.target == rule["target"]


def test_wrong_command_source_fails_closed() -> None:
    result = decide_execution_transition(ExecutionState.PLANNED, TransitionCommand.START)
    assert not result.accepted
    assert result.error == "invalid_source_state"


def test_authorization_replacement_is_explicit_state_idempotence() -> None:
    result = decide_execution_transition(ExecutionState.AUTHORIZED, TransitionCommand.AUTHORIZE)
    assert result.accepted
    assert not result.changed
    assert result.target == ExecutionState.AUTHORIZED.value


def test_terminal_execution_states_cannot_leave_terminality() -> None:
    for state in TERMINAL_STATES:
        with pytest.raises(InvalidTransition):
            assert_legal_execution_edge(state, ExecutionState.PREPARED)


def test_command_aware_transaction_transition() -> None:
    tx = make_tx()
    apply_transaction_transition(tx, TransitionCommand.PREPARE)
    assert tx.execution_state == ExecutionState.PREPARED
    apply_transaction_transition(tx, TransitionCommand.AUTHORIZE)
    assert tx.execution_state == ExecutionState.AUTHORIZED
    apply_transaction_transition(tx, TransitionCommand.START)
    assert tx.execution_state == ExecutionState.STARTED
    apply_transaction_transition(tx, TransitionCommand.MARK_UNKNOWN)
    assert tx.execution_state == ExecutionState.UNKNOWN
    apply_transaction_transition(tx, TransitionCommand.RECONCILE_NOT_HAPPENED_RETRY)
    assert tx.execution_state == ExecutionState.PREPARED


@pytest.mark.asyncio
async def test_generic_store_rejects_illegal_execution_state_jump() -> None:
    store = InMemoryStore()
    tx = make_tx()
    await store.create_transaction(tx)
    current = await store.get_transaction(tx.transaction_id)
    current.execution_state = ExecutionState.RECEIPT_RECORDED
    with pytest.raises(InvalidTransition):
        await store.save_transaction(current)
