-- v0.2.11 workload identity attribution.
-- Execution attempts persist the authority credential identity and digest that admitted the
-- worker. The signed assertion itself is stored in the transactionally coupled evidence event.

ALTER TABLE execution_attempts
  ADD COLUMN IF NOT EXISTS workload_credential_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS workload_identity_digest TEXT NULL;

CREATE INDEX IF NOT EXISTS execution_attempts_workload_credential
  ON execution_attempts(workload_credential_id)
  WHERE workload_credential_id IS NOT NULL;
