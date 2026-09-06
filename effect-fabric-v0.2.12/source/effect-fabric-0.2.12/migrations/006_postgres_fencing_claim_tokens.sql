-- v0.2.9 PostgreSQL fencing and dispatcher-claim hardening.
-- A claim token prevents a stale dispatcher instance from acknowledging a row after the same
-- logical worker id has reclaimed it. The active-attempt uniqueness guard turns accidental
-- double ownership into a database-level failure instead of relying solely on application code.

ALTER TABLE effect_evidence_outbox
  ADD COLUMN IF NOT EXISTS claim_token UUID NULL;

CREATE UNIQUE INDEX IF NOT EXISTS one_active_attempt_per_transaction
  ON execution_attempts(transaction_id)
  WHERE state='active';

CREATE INDEX IF NOT EXISTS claimed_effect_evidence_tokens
  ON effect_evidence_outbox(claim_token)
  WHERE status='claimed' AND claim_token IS NOT NULL;
