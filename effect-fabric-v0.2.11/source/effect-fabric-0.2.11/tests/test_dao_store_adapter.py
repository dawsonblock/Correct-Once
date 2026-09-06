from __future__ import annotations

from pathlib import Path

import pytest

from effect_fabric.qualification.dao_store import DaoSqliteStoreAdapter, DaoStoreError


def action(*, revision: int = 1, status: str = "READY") -> dict[str, object]:
    return {
        "id": "act-1",
        "intent": {
            "namespace": "test",
            "subject": "subject-1",
            "intentVersion": 1,
            "payload": {"x": 1},
        },
        "idempotencyKey": "idem-1",
        "seq": 1,
        "status": status,
        "epoch": 0,
        "revision": revision,
        "attempted": False,
        "attempts": 0,
        "deliveries": ["d-1"],
    }


def audit(seq: int, *, to: str = "READY") -> dict[str, object]:
    return {
        "seq": seq,
        "actionId": "act-1",
        "from": None if seq == 1 else "READY",
        "to": to,
        "epoch": 0,
        "at": seq,
        "cause": "approved",
    }


def test_commit_is_atomic_across_action_and_audit(tmp_path: Path) -> None:
    store = DaoSqliteStoreAdapter(tmp_path / "store.db")
    try:
        assert store.commit(expected_revision=None, action=action(), events=[audit(1)])
        before = store.load_action("act-1")
        assert before is not None
        mutated = dict(before)
        mutated["revision"] = 2
        mutated["status"] = "LEASED"
        with pytest.raises(DaoStoreError):
            store.commit(expected_revision=1, action=mutated, events=[audit(1, to="LEASED")])
        assert store.load_action("act-1") == before
        assert len(store.read_audit()) == 1
    finally:
        store.close()


def test_compare_and_swap_conflict_is_noop(tmp_path: Path) -> None:
    store = DaoSqliteStoreAdapter(tmp_path / "store.db")
    try:
        assert store.commit(expected_revision=None, action=action(), events=[audit(1)])
        mutated = action(revision=2, status="LEASED")
        assert not store.commit(expected_revision=9, action=mutated, events=[])
        assert store.load_action("act-1")["status"] == "READY"  # type: ignore[index]
    finally:
        store.close()


def test_queries_and_claim_semantics(tmp_path: Path) -> None:
    store = DaoSqliteStoreAdapter(tmp_path / "store.db")
    try:
        assert store.commit(expected_revision=None, action=action(), events=[audit(1)])
        assert store.find_by_subject("subject-1")[0]["id"] == "act-1"
        assert store.find_by_idempotency_key("idem-1")["id"] == "act-1"  # type: ignore[index]
        assert store.claim_next(0)["id"] == "act-1"  # type: ignore[index]
        assert store.next_audit_seq() == 2
    finally:
        store.close()


def test_restart_preserves_action_and_audit(tmp_path: Path) -> None:
    db = tmp_path / "store.db"
    first = DaoSqliteStoreAdapter(db)
    assert first.commit(expected_revision=None, action=action(), events=[audit(1)])
    first.close()
    second = DaoSqliteStoreAdapter(db)
    try:
        assert second.load_action("act-1") == action()
        assert second.read_audit() == [audit(1)]
        assert second.next_audit_seq() == 2
    finally:
        second.close()


def test_two_connections_observe_cas_conflict(tmp_path: Path) -> None:
    db = tmp_path / "store.db"
    first = DaoSqliteStoreAdapter(db)
    second = DaoSqliteStoreAdapter(db)
    try:
        assert first.commit(expected_revision=None, action=action(), events=[audit(1)])
        stale = second.load_action("act-1")
        assert stale is not None
        fresh = dict(first.load_action("act-1") or {})
        fresh["revision"] = 2
        fresh["status"] = "LEASED"
        assert first.commit(expected_revision=1, action=fresh, events=[])
        stale["revision"] = 2
        stale["status"] = "ATTEMPTING"
        assert not second.commit(expected_revision=1, action=stale, events=[])
        assert second.load_action("act-1")["status"] == "LEASED"  # type: ignore[index]
    finally:
        first.close()
        second.close()
