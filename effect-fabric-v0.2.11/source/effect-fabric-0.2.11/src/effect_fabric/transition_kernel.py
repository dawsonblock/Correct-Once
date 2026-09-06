"""Canonical pure execution-state transition kernel.

This module is intentionally small and side-effect free.  The canonical structure is generated
from ``spec/effect-transition-v1.json``; callers provide the current state and command explicitly.
The kernel does not read clocks, databases, environment variables, files, provider state, or
credentials while deciding a transition.

v0.2.11 makes this kernel authoritative for legal execution-state edges across the EffectEngine,
in-memory store, PostgreSQL store, and the Python qualification reducer.  Command-specific facts
such as fencing ownership and provider ambiguity remain enforced by the surrounding lifecycle code.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from ._generated_transition_table import COMMANDS, LEGAL_EDGES, TERMINAL_STATES
from .errors import InvalidTransition
from .models import EffectTransaction, ExecutionState


class TransitionCommand(StrEnum):
    PREPARE = "prepare"
    AUTHORIZE = "authorize"
    START = "start"
    MARK_UNKNOWN = "mark_unknown"
    RECOVER_ORPHAN = "recover_orphan"
    PROVIDER_RETRYABLE_PRE_EFFECT_FAILURE = "provider_retryable_pre_effect_failure"
    PROVIDER_DEFINITIVE_FAILURE = "provider_definitive_failure"
    RECORD_RECEIPT = "record_receipt"
    RECONCILE_HAPPENED = "reconcile_happened"
    RECONCILE_NOT_HAPPENED_TERMINAL = "reconcile_not_happened_terminal"
    RECONCILE_NOT_HAPPENED_RETRY = "reconcile_not_happened_retry"


class _HasExecutionState(Protocol):
    execution_state: ExecutionState


@dataclass(frozen=True)
class TransitionDecision:
    command: str
    current: str
    target: str
    accepted: bool
    changed: bool
    requested_effects: tuple[str, ...] = ()
    error: str | None = None


def _state_value(value: ExecutionState | str) -> str:
    return value.value if isinstance(value, ExecutionState) else str(value)


def decide_execution_transition(
    current: ExecutionState | str,
    command: TransitionCommand | str,
) -> TransitionDecision:
    current_value = _state_value(current)
    command_value = command.value if isinstance(command, TransitionCommand) else str(command)
    rule = COMMANDS.get(command_value)
    if rule is None:
        return TransitionDecision(
            command=command_value,
            current=current_value,
            target=current_value,
            accepted=False,
            changed=False,
            error="unknown_command",
        )
    target = str(rule["target"])
    requested = tuple(str(item) for item in rule["requested_effects"])
    idempotent_sources = tuple(str(item) for item in rule.get("idempotent_sources", ()))
    if current_value in idempotent_sources and current_value == target:
        return TransitionDecision(
            command=command_value,
            current=current_value,
            target=target,
            accepted=True,
            changed=False,
            requested_effects=requested,
        )
    if current_value not in rule["sources"]:
        return TransitionDecision(
            command=command_value,
            current=current_value,
            target=target,
            accepted=False,
            changed=False,
            requested_effects=(),
            error="invalid_source_state",
        )
    return TransitionDecision(
        command=command_value,
        current=current_value,
        target=target,
        accepted=True,
        changed=current_value != target,
        requested_effects=requested,
    )


def assert_legal_execution_edge(
    current: ExecutionState | str,
    target: ExecutionState | str,
) -> None:
    """Validate a persisted execution-state edge independent of its command.

    Generic store writes use this as a defence-in-depth boundary. Command-aware runtime paths use
    ``apply_transaction_transition`` below, which is stricter.
    """
    current_value = _state_value(current)
    target_value = _state_value(target)
    if current_value == target_value:
        return
    if current_value in TERMINAL_STATES:
        raise InvalidTransition(f"terminal execution state {current_value} cannot transition")
    if (current_value, target_value) not in LEGAL_EDGES:
        raise InvalidTransition(f"illegal execution transition {current_value} -> {target_value}")


def apply_transaction_transition(
    tx: _HasExecutionState,
    command: TransitionCommand | str,
) -> TransitionDecision:
    decision = decide_execution_transition(tx.execution_state, command)
    if not decision.accepted:
        raise InvalidTransition(
            f"command {decision.command} rejected from {decision.current}: {decision.error}"
        )
    if decision.changed:
        tx.execution_state = ExecutionState(decision.target)
    return decision


def validate_transaction_persistence(
    old: EffectTransaction,
    new: EffectTransaction,
) -> None:
    """Fail closed if a generic persistence path attempts an illegal execution-state edge."""
    assert_legal_execution_edge(old.execution_state, new.execution_state)
