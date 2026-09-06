"""Explicit semantic crosswalk between durable-agent-outbox and Effect Fabric states.

The DAO donor has a richer request/lease/withdrawal lifecycle than Effect Fabric's production
execution state. This mapping intentionally does not claim one-to-one equivalence. Unknown donor
statuses fail closed.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from .models import ExecutionState


class DaoSemanticClass(StrEnum):
    QUEUED = "queued"
    OWNED = "owned"
    DANGEROUS_BOUNDARY = "dangerous_boundary"
    AMBIGUOUS = "ambiguous"
    EXECUTED = "executed"
    PROVEN_NOT_LANDED = "proven_not_landed"
    ACKNOWLEDGED = "acknowledged"
    TERMINAL_WITHDRAWAL = "terminal_withdrawal"
    TERMINAL_FAILURE = "terminal_failure"


@dataclass(frozen=True)
class DaoCrosswalkEntry:
    semantic_class: DaoSemanticClass
    effect_state: ExecutionState | None
    terminal: bool
    notes: str


DAO_STATUS_CROSSWALK: dict[str, DaoCrosswalkEntry] = {
    "READY": DaoCrosswalkEntry(
        DaoSemanticClass.QUEUED,
        ExecutionState.PREPARED,
        False,
        "Ready for lease; no provider attempt is in flight.",
    ),
    "LEASED": DaoCrosswalkEntry(
        DaoSemanticClass.OWNED,
        ExecutionState.AUTHORIZED,
        False,
        "Worker ownership acquired; authority and ownership remain distinct.",
    ),
    "ATTEMPTING": DaoCrosswalkEntry(
        DaoSemanticClass.DANGEROUS_BOUNDARY,
        ExecutionState.STARTED,
        False,
        "Durable intent committed and provider call may be in flight.",
    ),
    "IN_DOUBT": DaoCrosswalkEntry(
        DaoSemanticClass.AMBIGUOUS,
        ExecutionState.UNKNOWN,
        False,
        "Provider outcome is unknown; reconciliation is required.",
    ),
    "EXECUTED": DaoCrosswalkEntry(
        DaoSemanticClass.EXECUTED,
        ExecutionState.RECEIPT_RECORDED,
        False,
        "Positive settlement is known before donor ACK bookkeeping.",
    ),
    "NOT_LANDED": DaoCrosswalkEntry(
        DaoSemanticClass.PROVEN_NOT_LANDED,
        ExecutionState.PREPARED,
        False,
        "Authoritative settlement says the prior attempt did not cross.",
    ),
    "ACKED": DaoCrosswalkEntry(
        DaoSemanticClass.ACKNOWLEDGED,
        ExecutionState.RECEIPT_RECORDED,
        True,
        "Donor terminal acknowledgement has no separate execution state.",
    ),
    "REVOKED_BEFORE_EXECUTION": DaoCrosswalkEntry(
        DaoSemanticClass.TERMINAL_WITHDRAWAL,
        ExecutionState.EXECUTION_FAILED,
        True,
        "Request terminated before the side effect crossed.",
    ),
    "SUPERSEDED_BEFORE_EXECUTION": DaoCrosswalkEntry(
        DaoSemanticClass.TERMINAL_WITHDRAWAL,
        ExecutionState.EXECUTION_FAILED,
        True,
        "Request was superseded before the side effect crossed.",
    ),
    "EXECUTED_THEN_WITHDRAWN": DaoCrosswalkEntry(
        DaoSemanticClass.TERMINAL_WITHDRAWAL,
        ExecutionState.RECONCILED,
        True,
        "Side effect crossed before withdrawal was settled.",
    ),
    "EXECUTED_THEN_SUPERSEDED": DaoCrosswalkEntry(
        DaoSemanticClass.TERMINAL_WITHDRAWAL,
        ExecutionState.RECONCILED,
        True,
        "Side effect crossed before supersession was settled.",
    ),
    "FAILED_TERMINAL": DaoCrosswalkEntry(
        DaoSemanticClass.TERMINAL_FAILURE,
        ExecutionState.EXECUTION_FAILED,
        True,
        "Donor terminal failure or escalation.",
    ),
}


def crosswalk_dao_status(status: str) -> DaoCrosswalkEntry:
    try:
        return DAO_STATUS_CROSSWALK[status]
    except KeyError as exc:
        raise ValueError(f"unknown durable-agent-outbox status: {status}") from exc
