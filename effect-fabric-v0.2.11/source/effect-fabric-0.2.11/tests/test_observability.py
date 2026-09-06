from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from effect_fabric.outbox import EvidenceIntent, EvidenceOutboxDispatcher
from effect_fabric.store import InMemoryStore


@pytest.mark.asyncio
async def test_outbox_stats_report_pending_claimed_delivered_and_redelivery():
    store = InMemoryStore()
    first = await store.enqueue_evidence("tx-1", EvidenceIntent(event_type="one"))
    second = await store.enqueue_evidence("tx-2", EvidenceIntent(event_type="two"))
    claimed = await store.claim_evidence(worker_id="w", lease_seconds=60)
    assert claimed is not None and claimed.outbox_id == first.outbox_id

    stats = await store.evidence_outbox_stats()
    assert stats.pending == 1
    assert stats.claimed == 1
    assert stats.delivered == 0
    assert stats.oldest_pending_age_seconds is not None

    store._outbox[first.outbox_id].claim_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    claimed_again = await store.claim_evidence(worker_id="w2", lease_seconds=60)
    assert claimed_again is not None and claimed_again.attempts == 2
    assert claimed_again.claim_token is not None
    await store.mark_evidence_delivered(
        first.outbox_id,
        worker_id="w2",
        claim_token=claimed_again.claim_token,
        event_id="event-1",
    )

    stats = await store.evidence_outbox_stats()
    assert stats.delivered == 1
    assert stats.redelivered == 1
    assert stats.max_attempts == 2
    assert second.outbox_id != first.outbox_id


@pytest.mark.asyncio
async def test_outbox_stats_track_dispatch_failures():
    store = InMemoryStore()
    await store.enqueue_evidence("tx", EvidenceIntent(event_type="event"))

    class BrokenLedger:
        def append(self, *args, **kwargs):
            raise RuntimeError("sink unavailable")

    dispatcher = EvidenceOutboxDispatcher(store, BrokenLedger())
    with pytest.raises(RuntimeError):
        await dispatcher.dispatch_one()
    stats = await store.evidence_outbox_stats()
    assert stats.failed == 1
    assert stats.pending == 1
