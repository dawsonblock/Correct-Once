from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Protocol
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

from .ledger import EvidenceEvent, EvidenceLedger


def utcnow() -> datetime:
    return datetime.now(UTC)


class OutboxStatus(StrEnum):
    PENDING = "pending"
    CLAIMED = "claimed"
    DELIVERED = "delivered"


class EvidenceIntent(BaseModel):
    """Evidence to persist atomically with a state transition.

    This is deliberately not a finalized hash-chain event.  It is the durable promise that a
    specific evidence event must eventually be materialized by the dispatcher.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    event_type: str
    payload: dict[str, Any] = Field(default_factory=dict)


class EvidenceOutboxStats(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    pending: int = 0
    claimed: int = 0
    expired_claims: int = 0
    delivered: int = 0
    redelivered: int = 0
    failed: int = 0
    oldest_pending_age_seconds: float | None = None
    max_attempts: int = 0


class EvidenceOutboxItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    outbox_id: str = Field(default_factory=lambda: str(uuid4()))
    transaction_id: str
    event_type: str
    payload: dict[str, Any] = Field(default_factory=dict)
    status: OutboxStatus = OutboxStatus.PENDING
    created_at: datetime = Field(default_factory=utcnow)
    claimed_at: datetime | None = None
    claim_owner: str | None = None
    claim_token: str | None = None
    claim_expires_at: datetime | None = None
    delivered_at: datetime | None = None
    delivered_event_id: str | None = None
    attempts: int = 0
    last_error: str | None = None


class OutboxStore(Protocol):
    async def enqueue_evidence(
        self,
        transaction_id: str,
        evidence: EvidenceIntent,
    ) -> EvidenceOutboxItem: ...

    async def claim_evidence(
        self,
        *,
        worker_id: str,
        lease_seconds: int = 30,
    ) -> EvidenceOutboxItem | None: ...

    async def mark_evidence_delivered(
        self,
        outbox_id: str,
        *,
        worker_id: str,
        claim_token: str,
        event_id: str,
    ) -> None: ...

    async def release_evidence_claim(
        self,
        outbox_id: str,
        *,
        worker_id: str,
        claim_token: str,
        error: str,
    ) -> None: ...

    async def pending_evidence_count(self) -> int: ...

    async def evidence_outbox_stats(self) -> EvidenceOutboxStats: ...


class EvidenceOutboxDispatcher:
    """At-least-once outbox dispatcher with idempotent ledger materialization.

    The ledger must deduplicate by ``source_outbox_id``. This closes the classic crash window:

        append ledger event -> crash -> outbox not acknowledged -> redelivery

    Redelivery returns the existing event instead of extending the chain twice.
    """

    def __init__(
        self,
        store: OutboxStore,
        ledger: EvidenceLedger,
        *,
        worker_id: str = "evidence-dispatcher",
        lease_seconds: int = 30,
    ):
        self.store = store
        self.ledger = ledger
        self.worker_id = worker_id
        self.lease_seconds = lease_seconds

    async def dispatch_one(self, *, after_append_hook=None) -> EvidenceEvent | None:
        item = await self.store.claim_evidence(
            worker_id=self.worker_id,
            lease_seconds=self.lease_seconds,
        )
        if item is None:
            return None
        try:
            result = self.ledger.append(
                item.transaction_id,
                item.event_type,
                item.payload,
                source_outbox_id=item.outbox_id,
            )
            if hasattr(result, "__await__"):
                event = await result
            else:
                event = result
            if after_append_hook is not None:
                after_append_hook(item, event)
            if item.claim_token is None:
                raise RuntimeError("claimed outbox item is missing a claim token")
            await self.store.mark_evidence_delivered(
                item.outbox_id,
                worker_id=self.worker_id,
                claim_token=item.claim_token,
                event_id=event.event_id,
            )
            return event
        except BaseException as exc:
            # Simulated process death intentionally leaves a claimed row for lease-based replay.
            if isinstance(exc, Exception):
                if item.claim_token is not None:
                    await self.store.release_evidence_claim(
                        item.outbox_id,
                        worker_id=self.worker_id,
                        claim_token=item.claim_token,
                        error=type(exc).__name__,
                    )
            raise

    async def drain(self, *, limit: int = 1000) -> list[EvidenceEvent]:
        events: list[EvidenceEvent] = []
        for _ in range(limit):
            event = await self.dispatch_one()
            if event is None:
                break
            events.append(event)
        return events
