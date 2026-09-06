from __future__ import annotations

import copy

import pytest

from effect_fabric.qualification.dao_active_guard import DaoActiveGuardError, validate_commit


def action(status: str = "READY", revision: int = 1) -> dict:
    return {
        "id": "act-1",
        "intent": {"subject": "subj-1"},
        "idempotencyKey": "idem-1",
        "seq": 1,
        "status": status,
        "epoch": 0,
        "revision": revision,
        "attempted": False,
        "attempts": 0,
        "deliveries": ["d1"],
    }


def test_guard_accepts_create() -> None:
    created = action()
    result = validate_commit(
        before=None,
        expected_revision=None,
        action=created,
        events=[{"seq": 1, "actionId": "act-1", "from": None, "to": "READY"}],
    )
    assert result["accepted"] is True


def test_guard_rejects_status_change_without_audit() -> None:
    before = action()
    after = copy.deepcopy(before)
    after["status"] = "LEASED"
    after["revision"] = 2
    after["epoch"] = 1
    with pytest.raises(DaoActiveGuardError, match="without an audit"):
        validate_commit(
            before=before,
            expected_revision=1,
            action=after,
            events=[],
        )


def test_guard_rejects_crossed_effect_rewrite() -> None:
    before = action("EXECUTED", revision=5)
    before["attempted"] = True
    before["attempts"] = 1
    after = copy.deepcopy(before)
    after["status"] = "REVOKED_BEFORE_EXECUTION"
    after["revision"] = 6
    with pytest.raises(DaoActiveGuardError, match="crossed effect"):
        validate_commit(
            before=before,
            expected_revision=5,
            action=after,
            events=[
                {
                    "seq": 6,
                    "actionId": "act-1",
                    "from": "EXECUTED",
                    "to": "REVOKED_BEFORE_EXECUTION",
                }
            ],
        )


def test_guard_rejects_terminal_mutation() -> None:
    before = action("ACKED", revision=7)
    before["attempted"] = True
    before["attempts"] = 1
    after = copy.deepcopy(before)
    after["revision"] = 8
    with pytest.raises(DaoActiveGuardError, match="terminal action"):
        validate_commit(
            before=before,
            expected_revision=7,
            action=after,
            events=[],
        )
