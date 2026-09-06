-- Upgrade v0.1.0 databases to transaction-bound capability semantics.
-- Existing unbound capabilities are revoked because they cannot be safely attributed.

ALTER TABLE execution_capabilities
  ADD COLUMN IF NOT EXISTS transaction_id UUID NULL REFERENCES effect_transactions(transaction_id),
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ NULL;

UPDATE execution_capabilities
SET status = CASE
  WHEN consumed_at IS NOT NULL THEN 'consumed'
  ELSE 'revoked'
END
WHERE status IS NULL;

ALTER TABLE execution_capabilities
  ALTER COLUMN status SET DEFAULT 'active',
  ALTER COLUMN status SET NOT NULL;

ALTER TABLE execution_capabilities
  DROP CONSTRAINT IF EXISTS execution_capabilities_status_check;

ALTER TABLE execution_capabilities
  ADD CONSTRAINT execution_capabilities_status_check
  CHECK (status IN ('active', 'consumed', 'revoked', 'expired'));

-- No v0.1.0 capability is safe to reactivate automatically because transaction identity was not
-- included in its signature. New authorizations must be issued after migration.
UPDATE execution_capabilities
SET status='revoked', revoked_at=COALESCE(revoked_at, now())
WHERE transaction_id IS NULL AND status='active';

CREATE UNIQUE INDEX IF NOT EXISTS one_active_capability_per_transaction
  ON execution_capabilities(transaction_id)
  WHERE status='active' AND transaction_id IS NOT NULL;
