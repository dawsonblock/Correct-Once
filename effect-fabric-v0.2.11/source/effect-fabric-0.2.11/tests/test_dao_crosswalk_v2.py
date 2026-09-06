from __future__ import annotations

import pytest

from effect_fabric.dao_crosswalk import DAO_STATUS_CROSSWALK, DaoSemanticClass, crosswalk_dao_status
from effect_fabric.models import ExecutionState


def test_locked_dao_status_crosswalk_is_explicit_and_complete() -> None:
    expected = {
        "READY",
        "LEASED",
        "ATTEMPTING",
        "IN_DOUBT",
        "EXECUTED",
        "NOT_LANDED",
        "ACKED",
        "REVOKED_BEFORE_EXECUTION",
        "SUPERSEDED_BEFORE_EXECUTION",
        "EXECUTED_THEN_WITHDRAWN",
        "EXECUTED_THEN_SUPERSEDED",
        "FAILED_TERMINAL",
    }
    assert set(DAO_STATUS_CROSSWALK) == expected
    assert crosswalk_dao_status("ATTEMPTING").effect_state == ExecutionState.STARTED
    assert crosswalk_dao_status("IN_DOUBT").effect_state == ExecutionState.UNKNOWN
    assert crosswalk_dao_status("NOT_LANDED").semantic_class == DaoSemanticClass.PROVEN_NOT_LANDED


def test_new_unknown_dao_status_fails_closed() -> None:
    with pytest.raises(ValueError, match="unknown durable-agent-outbox status"):
        crosswalk_dao_status("SOMETHING_NEW")
