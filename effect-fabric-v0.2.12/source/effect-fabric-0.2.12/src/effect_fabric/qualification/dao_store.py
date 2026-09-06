"""SQLite-backed durable-agent-outbox store compatibility adapter.

This adapter exists solely to let the *official* durable-agent-outbox conformance package grade an
Effect Fabric-owned persistence implementation through the donor's public ``OutboxStore`` port.
It intentionally stores donor-shaped JSON documents rather than translating them into
``EffectTransaction`` objects: the qualification question here is whether Effect Fabric can meet the
store contract (CAS, atomic action+audit commit, append-only audit, deterministic queries) without
vendoring the donor runtime.

The adapter uses Python's stdlib sqlite3 module, WAL mode, and ``BEGIN IMMEDIATE`` for each commit.
It is a qualification/reference store, not the production Effect Fabric PostgreSQL store.
"""
from __future__ import annotations

import json
import sqlite3
from copy import deepcopy
from pathlib import Path
from typing import Any


class DaoStoreError(RuntimeError):
    """Raised when the donor store contract is violated by the caller."""


class DaoSqliteStoreAdapter:
    """Small SQLite implementation of the durable-agent-outbox ``OutboxStore`` contract."""

    def __init__(self, path: str | Path):
        self.path = str(path)
        self._conn = sqlite3.connect(self.path, isolation_level=None)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=FULL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS dao_actions (
                id TEXT PRIMARY KEY,
                subject TEXT NOT NULL,
                idempotency_key TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL,
                revision INTEGER NOT NULL,
                seq INTEGER NOT NULL,
                document TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_dao_actions_subject
                ON dao_actions(subject, id);
            CREATE INDEX IF NOT EXISTS idx_dao_actions_status
                ON dao_actions(status, id);
            CREATE TABLE IF NOT EXISTS dao_audit (
                seq INTEGER PRIMARY KEY,
                action_id TEXT NOT NULL,
                document TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_dao_audit_action
                ON dao_audit(action_id, seq);
            """
        )

    @staticmethod
    def _dump(value: Any) -> str:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

    @staticmethod
    def _load(value: str) -> Any:
        return json.loads(value)

    def close(self) -> None:
        self._conn.close()

    def load_action(self, action_id: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            "SELECT document FROM dao_actions WHERE id = ?", (action_id,)
        ).fetchone()
        return None if row is None else deepcopy(self._load(row[0]))

    def find_by_subject(self, subject: str) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            "SELECT document FROM dao_actions WHERE subject = ? ORDER BY id", (subject,)
        ).fetchall()
        return [deepcopy(self._load(row[0])) for row in rows]

    def find_by_idempotency_key(self, key: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            "SELECT document FROM dao_actions WHERE idempotency_key = ?", (key,)
        ).fetchone()
        return None if row is None else deepcopy(self._load(row[0]))

    def next_audit_seq(self) -> int:
        row = self._conn.execute("SELECT COALESCE(MAX(seq), 0) FROM dao_audit").fetchone()
        return int(row[0]) + 1

    def commit(
        self,
        *,
        expected_revision: int | None,
        action: dict[str, Any],
        events: list[dict[str, Any]],
    ) -> bool:
        """CAS-write one action and append its audit rows atomically.

        ``False`` is reserved for a revision conflict, matching the donor port. Audit-sequence
        misuse is a hard store error because retrying the same malformed event cannot converge.
        """
        self._conn.execute("BEGIN IMMEDIATE")
        try:
            row = self._conn.execute(
                "SELECT revision FROM dao_actions WHERE id = ?", (action["id"],)
            ).fetchone()
            current_revision = None if row is None else int(row[0])
            if expected_revision is None:
                if current_revision is not None:
                    self._conn.execute("ROLLBACK")
                    return False
            elif current_revision != int(expected_revision):
                self._conn.execute("ROLLBACK")
                return False

            highest = int(
                self._conn.execute("SELECT COALESCE(MAX(seq), 0) FROM dao_audit").fetchone()[0]
            )
            previous = highest
            for event in events:
                seq = int(event["seq"])
                if seq <= previous:
                    raise DaoStoreError(
                        f"audit seq {seq} is not above {previous}; sequence numbers are append-only"
                    )
                previous = seq

            intent = action.get("intent") or {}
            subject = intent.get("subject")
            if not isinstance(subject, str):
                raise DaoStoreError("action intent.subject must be a string")
            idem = action.get("idempotencyKey")
            if not isinstance(idem, str):
                raise DaoStoreError("action idempotencyKey must be a string")

            document = self._dump(action)
            if current_revision is None:
                self._conn.execute(
                    """
                    INSERT INTO dao_actions(
                        id, subject, idempotency_key, status, revision, seq, document
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        action["id"],
                        subject,
                        idem,
                        action["status"],
                        int(action["revision"]),
                        int(action["seq"]),
                        document,
                    ),
                )
            else:
                self._conn.execute(
                    """
                    UPDATE dao_actions
                       SET subject = ?, idempotency_key = ?, status = ?, revision = ?, seq = ?,
                           document = ?
                     WHERE id = ?
                    """,
                    (
                        subject,
                        idem,
                        action["status"],
                        int(action["revision"]),
                        int(action["seq"]),
                        document,
                        action["id"],
                    ),
                )

            for event in events:
                self._conn.execute(
                    "INSERT INTO dao_audit(seq, action_id, document) VALUES (?, ?, ?)",
                    (int(event["seq"]), event["actionId"], self._dump(event)),
                )
            self._conn.execute("COMMIT")
            return True
        except Exception:
            if self._conn.in_transaction:
                self._conn.execute("ROLLBACK")
            raise

    def claim_next(self, now: int) -> dict[str, Any] | None:
        rows = self._conn.execute(
            "SELECT document FROM dao_actions WHERE status IN ('READY', 'LEASED') ORDER BY id"
        ).fetchall()
        for row in rows:
            action = self._load(row[0])
            if action["status"] == "READY":
                return deepcopy(action)
            expiry = action.get("leaseExpiresAt")
            if expiry is not None and int(expiry) <= int(now):
                return deepcopy(action)
        return None

    def _by_status(self, status: str) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            "SELECT document FROM dao_actions WHERE status = ? ORDER BY id", (status,)
        ).fetchall()
        return [deepcopy(self._load(row[0])) for row in rows]

    def list_in_doubt(self) -> list[dict[str, Any]]:
        return self._by_status("IN_DOUBT")

    def list_retryable(self) -> list[dict[str, Any]]:
        return self._by_status("NOT_LANDED")

    def list_attempting(self) -> list[dict[str, Any]]:
        return self._by_status("ATTEMPTING")

    def read_audit(self, action_id: str | None = None) -> list[dict[str, Any]]:
        if action_id is None:
            rows = self._conn.execute("SELECT document FROM dao_audit ORDER BY seq").fetchall()
        else:
            rows = self._conn.execute(
                "SELECT document FROM dao_audit WHERE action_id = ? ORDER BY seq", (action_id,)
            ).fetchall()
        return [deepcopy(self._load(row[0])) for row in rows]
