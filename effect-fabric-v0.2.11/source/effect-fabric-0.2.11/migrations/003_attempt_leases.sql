-- Upgrade v0.1.1 attempts to v0.1.2 lease/fencing recovery semantics.
ALTER TABLE execution_attempts
  ADD COLUMN IF NOT EXISTS lease_owner TEXT,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS recovered_at TIMESTAMPTZ;

UPDATE execution_attempts
SET lease_owner=COALESCE(lease_owner, 'legacy-v0.1.1'),
    lease_expires_at=COALESCE(lease_expires_at, started_at),
    state=COALESCE(state, CASE WHEN finished_at IS NULL THEN 'active' ELSE 'succeeded' END)
WHERE lease_owner IS NULL OR lease_expires_at IS NULL OR state IS NULL;

ALTER TABLE execution_attempts
  ALTER COLUMN lease_owner SET NOT NULL,
  ALTER COLUMN lease_expires_at SET NOT NULL,
  ALTER COLUMN state SET DEFAULT 'active',
  ALTER COLUMN state SET NOT NULL;

ALTER TABLE execution_attempts
  DROP CONSTRAINT IF EXISTS execution_attempts_state_check;
ALTER TABLE execution_attempts
  ADD CONSTRAINT execution_attempts_state_check
  CHECK (state IN ('active','succeeded','failed','unknown','orphaned','reconciled'));

CREATE INDEX IF NOT EXISTS stale_active_attempts
  ON execution_attempts(lease_expires_at)
  WHERE state='active';
