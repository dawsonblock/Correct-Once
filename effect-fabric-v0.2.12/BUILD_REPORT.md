# Effect Fabric v0.2.11 — Final Artifact Verification

**Release:** `0.2.11-trust-boundary-hardening`  
**Release posture:** `REFERENCE_QUALIFIED`

The exact source distribution and wheel included in this bundle were validated independently of the
mutable development tree.

## Source qualification

- Core/local suite: **172 passed, 2 skipped**.
- Skips: `tests/test_postgres_failure_matrix.py` and `tests/test_postgres_integration.py` because
  `psycopg` and a live PostgreSQL DSN are unavailable in this environment.
- Local static sanity: **PASS**.
- Workload identity local gate: **PASS**.
- External anchor local gate: **PASS**.
- Effect Gateway local gate: **PASS**.
- Canonical transition gate: **PASS**.
- Qualification artifact determinism: **PASS**.

## Artifact verification

- Extracted source tar release-integrity verifier: **PASS**.
- Extracted source tar pytest: **174 total / 172 passed / 2 skipped / 0 failed**.
- Isolated wheel imports as `effect-fabric 0.2.11`: **PASS**.
- Isolated wheel executes an effect with `require_workload_identity=True`: **PASS**.
- Attempt workload credential persistence: **PASS**.
- Evidence ledger verification from installed wheel: **PASS**.
- Installed wheel CLI demo: **PASS**.
- Wheel payload audit including migrations 001–007, native DAO kernel/bridges, transition spec, and
  license notices: **PASS**.

## Production gates still NOT_RUN

- live PostgreSQL crash/fencing matrix;
- external DAO donor qualification;
- Ruff and mypy (not installed in this environment);
- live GitHub/provider fault qualification;
- independently administered WORM/Object-Lock anchor deployment;
- KMS/HSM-backed or platform-attested production workload identity;
- production native-kernel promotion.

The bundle therefore does not make a production-qualified claim.
