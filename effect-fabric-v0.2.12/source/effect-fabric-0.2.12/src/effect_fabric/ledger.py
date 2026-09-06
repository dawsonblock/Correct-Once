from __future__ import annotations

import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Awaitable, Protocol
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

from .canonical import canonical_json, digest_document


class EvidenceEvent(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    sequence: int = Field(ge=1)
    event_id: str = Field(default_factory=lambda: str(uuid4()))
    transaction_id: str
    event_type: str
    payload: dict[str, Any] = Field(default_factory=dict)
    source_outbox_id: str | None = None
    occurred_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    prior_hash: str | None
    event_hash: str


class EvidenceLedger(Protocol):
    def append(
        self,
        transaction_id: str,
        event_type: str,
        payload: dict[str, Any] | None = None,
        *,
        source_outbox_id: str | None = None,
    ) -> EvidenceEvent | Awaitable[EvidenceEvent]: ...


def event_hash_body(
    *,
    sequence: int,
    transaction_id: str,
    event_type: str,
    payload: dict[str, Any],
    source_outbox_id: str | None,
    occurred_at: datetime,
    prior_hash: str | None,
) -> dict[str, Any]:
    return {
        "sequence": sequence,
        "transaction_id": transaction_id,
        "event_type": event_type,
        "payload": payload,
        "source_outbox_id": source_outbox_id,
        "occurred_at": occurred_at.isoformat(),
        "prior_hash": prior_hash,
    }


class HashChainLedger:
    """In-memory reference ledger with outbox-id deduplication."""

    def __init__(self):
        self._events: list[EvidenceEvent] = []
        self._outbox_events: dict[str, EvidenceEvent] = {}

    def append(
        self,
        transaction_id: str,
        event_type: str,
        payload: dict[str, Any] | None = None,
        *,
        source_outbox_id: str | None = None,
    ) -> EvidenceEvent:
        if source_outbox_id is not None and source_outbox_id in self._outbox_events:
            return self._outbox_events[source_outbox_id]
        prior = self._events[-1].event_hash if self._events else None
        sequence = len(self._events) + 1
        occurred_at = datetime.now(UTC)
        body = event_hash_body(
            sequence=sequence,
            transaction_id=transaction_id,
            event_type=event_type,
            payload=payload or {},
            source_outbox_id=source_outbox_id,
            occurred_at=occurred_at,
            prior_hash=prior,
        )
        event = EvidenceEvent(
            sequence=sequence,
            transaction_id=transaction_id,
            event_type=event_type,
            payload=payload or {},
            source_outbox_id=source_outbox_id,
            occurred_at=occurred_at,
            prior_hash=prior,
            event_hash=digest_document(body),
        )
        self._events.append(event)
        if source_outbox_id is not None:
            self._outbox_events[source_outbox_id] = event
        return event

    def events(self) -> list[EvidenceEvent]:
        return list(self._events)

    def verify(self) -> bool:
        return verify_events(self._events)

    @property
    def root(self) -> str | None:
        return self._events[-1].event_hash if self._events else None

    @property
    def count(self) -> int:
        return len(self._events)

    def hash_at(self, sequence: int) -> str | None:
        if sequence < 1 or sequence > len(self._events):
            return None
        return self._events[sequence - 1].event_hash


class FileHashChainLedger(HashChainLedger):
    """Fsync-backed single-process evidence ledger used for local durability qualification."""

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        super().__init__()
        if self.path.exists():
            self._load()

    def _load(self) -> None:
        import json

        events: list[EvidenceEvent] = []
        with self.path.open("rb") as handle:
            for line_number, line in enumerate(handle, start=1):
                if not line.strip():
                    continue
                try:
                    events.append(EvidenceEvent.model_validate(json.loads(line)))
                except Exception as exc:
                    raise ValueError(f"invalid evidence ledger line {line_number}") from exc
        if not verify_events(events):
            raise ValueError("evidence ledger integrity verification failed")
        self._events = events
        self._outbox_events = {
            event.source_outbox_id: event
            for event in events
            if event.source_outbox_id is not None
        }

    def append(
        self,
        transaction_id: str,
        event_type: str,
        payload: dict[str, Any] | None = None,
        *,
        source_outbox_id: str | None = None,
    ) -> EvidenceEvent:
        existing = (
            self._outbox_events.get(source_outbox_id) if source_outbox_id is not None else None
        )
        if existing is not None:
            return existing
        event = super().append(
            transaction_id,
            event_type,
            payload,
            source_outbox_id=source_outbox_id,
        )
        try:
            encoded = canonical_json(event.model_dump(mode="json")) + b"\n"
            fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
            try:
                os.write(fd, encoded)
                os.fsync(fd)
            finally:
                os.close(fd)
        except Exception:
            self._events.pop()
            if source_outbox_id is not None:
                self._outbox_events.pop(source_outbox_id, None)
            raise
        return event


def verify_events(events: list[EvidenceEvent]) -> bool:
    prior = None
    seen_outbox: set[str] = set()
    for index, event in enumerate(events, start=1):
        if event.sequence != index or event.prior_hash != prior:
            return False
        if event.source_outbox_id is not None:
            if event.source_outbox_id in seen_outbox:
                return False
            seen_outbox.add(event.source_outbox_id)
        body = event_hash_body(
            sequence=event.sequence,
            transaction_id=event.transaction_id,
            event_type=event.event_type,
            payload=event.payload,
            source_outbox_id=event.source_outbox_id,
            occurred_at=event.occurred_at,
            prior_hash=event.prior_hash,
        )
        if digest_document(body) != event.event_hash:
            return False
        prior = event.event_hash
    return True
