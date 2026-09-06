from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from .canonical import digest_document
from .ledger import EvidenceEvent, event_hash_body, verify_events

try:  # optional dependency
    from psycopg.rows import dict_row
    from psycopg.types.json import Jsonb
except ImportError:  # pragma: no cover - exercised in optional-dependency CI
    dict_row = None
    Jsonb = None


def _jsonb(value: dict[str, Any]) -> Any:
    if Jsonb is None:  # pragma: no cover - constructor already checks this
        raise RuntimeError("install effect-fabric[postgres] for PostgreSQL evidence")
    return Jsonb(value)


class PostgresEvidenceLedger:
    """Process-safe evidence chain serialized through a locked durable chain-head row."""

    def __init__(self, connection: Any, *, ledger_id: str = "default"):
        if dict_row is None or Jsonb is None:
            raise RuntimeError("install effect-fabric[postgres] for PostgreSQL evidence")
        self.conn = connection
        self.conn.row_factory = dict_row
        self.ledger_id = ledger_id

    async def append(
        self,
        transaction_id: str,
        event_type: str,
        payload: dict[str, Any] | None = None,
        *,
        source_outbox_id: str | None = None,
    ) -> EvidenceEvent:
        payload = payload or {}
        async with self.conn.transaction():
            if source_outbox_id is not None:
                existing = await (
                    await self.conn.execute(
                        """SELECT sequence, event_id, transaction_id, event_type, payload,
                                  source_outbox_id, occurred_at, prior_hash, event_hash
                           FROM effect_events
                           WHERE source_outbox_id=%s""",
                        (source_outbox_id,),
                    )
                ).fetchone()
                if existing is not None:
                    document = dict(existing)
                    document["event_id"] = str(document["event_id"])
                    document["transaction_id"] = str(document["transaction_id"])
                    if document.get("source_outbox_id") is not None:
                        document["source_outbox_id"] = str(document["source_outbox_id"])
                    return EvidenceEvent.model_validate(document)
            row = await (
                await self.conn.execute(
                    """SELECT current_sequence, current_root
                       FROM evidence_ledger_state
                       WHERE ledger_id=%s
                       FOR UPDATE""",
                    (self.ledger_id,),
                )
            ).fetchone()
            if row is None:
                await self.conn.execute(
                    """INSERT INTO evidence_ledger_state
                       (ledger_id, current_sequence, current_root)
                       VALUES (%s, 0, NULL)
                       ON CONFLICT (ledger_id) DO NOTHING""",
                    (self.ledger_id,),
                )
                row = await (
                    await self.conn.execute(
                        """SELECT current_sequence, current_root
                           FROM evidence_ledger_state
                           WHERE ledger_id=%s
                           FOR UPDATE""",
                        (self.ledger_id,),
                    )
                ).fetchone()
                if row is None:  # pragma: no cover - defensive database invariant
                    raise RuntimeError("unable to initialize evidence ledger state")

            sequence = int(row["current_sequence"]) + 1
            prior_hash = row["current_root"]
            occurred_at = datetime.now(UTC)
            body = event_hash_body(
                sequence=sequence,
                transaction_id=transaction_id,
                event_type=event_type,
                payload=payload,
                source_outbox_id=source_outbox_id,
                occurred_at=occurred_at,
                prior_hash=prior_hash,
            )
            event = EvidenceEvent(
                sequence=sequence,
                event_id=str(uuid4()),
                transaction_id=transaction_id,
                event_type=event_type,
                payload=payload,
                source_outbox_id=source_outbox_id,
                occurred_at=occurred_at,
                prior_hash=prior_hash,
                event_hash=digest_document(body),
            )
            await self.conn.execute(
                """INSERT INTO effect_events
                   (sequence, event_id, ledger_id, transaction_id, event_type,
                    payload, source_outbox_id, prior_hash, event_hash, occurred_at)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (
                    event.sequence,
                    event.event_id,
                    self.ledger_id,
                    event.transaction_id,
                    event.event_type,
                    _jsonb(event.payload),
                    event.source_outbox_id,
                    event.prior_hash,
                    event.event_hash,
                    event.occurred_at,
                ),
            )
            await self.conn.execute(
                """UPDATE evidence_ledger_state
                   SET current_sequence=%s, current_root=%s, updated_at=now()
                   WHERE ledger_id=%s""",
                (event.sequence, event.event_hash, self.ledger_id),
            )
            return event

    async def events(self) -> list[EvidenceEvent]:
        rows = await (
            await self.conn.execute(
                """SELECT sequence, event_id, transaction_id, event_type, payload,
                          source_outbox_id, occurred_at, prior_hash, event_hash
                   FROM effect_events
                   WHERE ledger_id=%s
                   ORDER BY sequence""",
                (self.ledger_id,),
            )
        ).fetchall()
        events = []
        for row in rows:
            document = dict(row)
            document["event_id"] = str(document["event_id"])
            document["transaction_id"] = str(document["transaction_id"])
            if document.get("source_outbox_id") is not None:
                document["source_outbox_id"] = str(document["source_outbox_id"])
            events.append(EvidenceEvent.model_validate(document))
        return events

    async def verify(self) -> bool:
        return verify_events(await self.events())

    async def count(self) -> int:
        row = await (
            await self.conn.execute(
                """SELECT current_sequence FROM evidence_ledger_state WHERE ledger_id=%s""",
                (self.ledger_id,),
            )
        ).fetchone()
        return int(row["current_sequence"]) if row else 0

    async def root(self) -> str | None:
        row = await (
            await self.conn.execute(
                """SELECT current_root FROM evidence_ledger_state WHERE ledger_id=%s""",
                (self.ledger_id,),
            )
        ).fetchone()
        return row["current_root"] if row else None

    async def hash_at(self, sequence: int) -> str | None:
        row = await (
            await self.conn.execute(
                """SELECT event_hash FROM effect_events
                   WHERE ledger_id=%s AND sequence=%s""",
                (self.ledger_id, sequence),
            )
        ).fetchone()
        return row["event_hash"] if row else None

    async def record_anchor_mirror(self, anchor, *, external_location: str | None = None) -> None:
        """Mirror metadata after the anchor has been durably written to the external sink."""
        await self.conn.execute(
            """INSERT INTO ledger_anchor_mirrors
               (anchor_id, ledger_id, sequence, ledger_root, previous_anchor_hash,
                anchor_hash, key_id, anchored_at, external_location)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (anchor_id) DO NOTHING""",
            (
                anchor.anchor_id,
                self.ledger_id,
                anchor.sequence,
                anchor.ledger_root,
                anchor.previous_anchor_hash,
                anchor.anchor_hash,
                anchor.key_id,
                anchor.anchored_at,
                external_location,
            ),
        )
        await self.conn.commit()
