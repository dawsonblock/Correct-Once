-- PostgreSQL schema for fresh v0.1.2 installs.
-- Security-critical transitions are transaction-bound and fenced. STARTED attempts carry a lease;
-- expired attempts can be fenced and moved to UNKNOWN before reconciliation.

CREATE TABLE IF NOT EXISTS effect_transactions (
  transaction_id UUID PRIMARY KEY,
  action_digest TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  intent JSONB NOT NULL,
  effect_contract JSONB NOT NULL,
  idempotency_contract JSONB NOT NULL,
  reversibility_spec JSONB NOT NULL,
  execution_state TEXT NOT NULL,
  verification_state TEXT NOT NULL,
  recovery_state TEXT NOT NULL,
  fencing_epoch BIGINT NOT NULL DEFAULT 0,
  capability_id UUID NULL,
  prepared JSONB NULL,
  receipt JSONB NULL,
  attestation JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  document JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS execution_capabilities (
  capability_id UUID PRIMARY KEY,
  transaction_id UUID NOT NULL REFERENCES effect_transactions(transaction_id),
  action_digest TEXT NOT NULL,
  subject TEXT NOT NULL,
  executor TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'consumed', 'revoked', 'expired')),
  consumed_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  document JSONB NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_capability_per_transaction
  ON execution_capabilities(transaction_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS execution_attempts (
  attempt_id UUID PRIMARY KEY,
  transaction_id UUID NOT NULL REFERENCES effect_transactions(transaction_id),
  executor TEXT NOT NULL,
  fencing_epoch BIGINT NOT NULL,
  lease_owner TEXT NOT NULL,
  lease_expires_at TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL DEFAULT 'active'
    CHECK (state IN ('active','succeeded','failed','unknown','orphaned','reconciled')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ NULL,
  recovered_at TIMESTAMPTZ NULL,
  UNIQUE(transaction_id, fencing_epoch)
);

CREATE INDEX IF NOT EXISTS stale_active_attempts
  ON execution_attempts(lease_expires_at)
  WHERE state='active';

CREATE UNIQUE INDEX IF NOT EXISTS one_active_attempt_per_transaction
  ON execution_attempts(transaction_id)
  WHERE state='active';

CREATE TABLE IF NOT EXISTS effect_events (
  sequence BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL UNIQUE,
  ledger_id TEXT NOT NULL DEFAULT 'default',
  transaction_id UUID NOT NULL REFERENCES effect_transactions(transaction_id),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  prior_hash TEXT,
  event_hash TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE INDEX IF NOT EXISTS effect_events_ledger_sequence
  ON effect_events(ledger_id, sequence);

CREATE TABLE IF NOT EXISTS evidence_ledger_state (
  ledger_id TEXT PRIMARY KEY,
  current_sequence BIGINT NOT NULL DEFAULT 0 CHECK (current_sequence >= 0),
  current_root TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO evidence_ledger_state (ledger_id, current_sequence, current_root)
VALUES ('default', 0, NULL)
ON CONFLICT (ledger_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS ledger_anchor_mirrors (
  anchor_id UUID PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'default',
  sequence BIGINT NOT NULL CHECK (sequence >= 1),
  ledger_root TEXT NOT NULL,
  previous_anchor_hash TEXT NULL,
  anchor_hash TEXT NOT NULL UNIQUE,
  key_id TEXT NOT NULL,
  anchored_at TIMESTAMPTZ NOT NULL,
  external_location TEXT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ledger_id, sequence)
);

-- v0.1.5 transactional evidence outbox.
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
