-- v0.1.4 evidence hardening.
-- Adds a durable serialized chain-head and external-anchor mirror metadata.

ALTER TABLE effect_events
  ADD COLUMN IF NOT EXISTS ledger_id TEXT NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS effect_events_ledger_sequence
  ON effect_events(ledger_id, sequence);

CREATE TABLE IF NOT EXISTS evidence_ledger_state (
  ledger_id TEXT PRIMARY KEY,
  current_sequence BIGINT NOT NULL DEFAULT 0 CHECK (current_sequence >= 0),
  current_root TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO evidence_ledger_state (ledger_id, current_sequence, current_root)
SELECT
  'default',
  COALESCE(MAX(sequence), 0),
  (SELECT event_hash FROM effect_events ORDER BY sequence DESC LIMIT 1)
FROM effect_events
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
