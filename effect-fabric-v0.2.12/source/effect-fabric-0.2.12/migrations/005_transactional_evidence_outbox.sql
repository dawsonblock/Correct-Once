-- v0.1.5 transactional evidence atomicity.
-- Security-critical state transitions now persist an evidence intent in the same database
-- transaction. A separate idempotent dispatcher materializes the intent into effect_events.

ALTER TABLE effect_events
  ADD COLUMN IF NOT EXISTS source_outbox_id UUID NULL;

CREATE UNIQUE INDEX IF NOT EXISTS one_event_per_outbox_item
  ON effect_events(source_outbox_id)
  WHERE source_outbox_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS effect_evidence_outbox (
  outbox_id UUID PRIMARY KEY,
  transaction_id UUID NOT NULL REFERENCES effect_transactions(transaction_id),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','claimed','delivered')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at TIMESTAMPTZ NULL,
  claim_owner TEXT NULL,
  claim_token UUID NULL,
  claim_expires_at TIMESTAMPTZ NULL,
  delivered_at TIMESTAMPTZ NULL,
  delivered_event_id UUID NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT NULL
);

CREATE INDEX IF NOT EXISTS pending_effect_evidence_outbox
  ON effect_evidence_outbox(created_at)
  WHERE status='pending';

CREATE INDEX IF NOT EXISTS expired_effect_evidence_claims
  ON effect_evidence_outbox(claim_expires_at)
  WHERE status='claimed';
