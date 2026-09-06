# Effect Fabric v0.2.12 — Build and Qualification Report

**Release:** `0.2.12-trust-boundary-hardening`  
**Date:** 2026-09-05

## Executive result

v0.2.12 extends the v0.2.10 Effect Gateway with locally qualified cryptographic workload identity
and environment/release-bound external ledger anchors. The build remains intentionally
`REFERENCE_QUALIFIED`; production workload attestation/KMS custody and real external WORM storage
are not claimed by local mechanism tests.

## Main changes

- Ed25519 workload authority, short-lived worker credentials, per-worker signing keys, and assertion verification.
- Optional fail-closed `require_workload_identity` enforcement before capability consumption.
- Signed start, attempt-bound, and outcome assertions coupled to evidence.
- Workload credential ID/digest persisted on execution attempts.
- PostgreSQL migration `007_workload_identity.sql`.
- Ledger anchors now bind environment and release identity.
- Exclusive `DirectoryAnchorStore` and SDK-free `HttpAnchorStore` external-anchor adapter.
- New source-bound `WORKLOAD_IDENTITY_QUALIFICATION.json` and `EXTERNAL_ANCHOR_QUALIFICATION.json` gates.

## Verified local qualification

- Python tests: **172 passed, 2 skipped**.
- Skips: live PostgreSQL modules only (`psycopg` / live DSN unavailable).
- Local static sanity: **PASS**.
- Canonical transition kernel: **PASS**.
- Effect Gateway local qualification: **PASS**.
- Workload identity local qualification: **PASS**.
- External anchor local qualification: **PASS**.
- Provider/evidence/transactional-evidence gates: **PASS**.
- Reducer equivalence and negative controls: **PASS**.
- Qualification artifact determinism: **PASS**.
- Overall release posture: **REFERENCE_QUALIFIED**.

## Explicit NOT_RUN production gates

- live PostgreSQL crash/fencing qualification;
- external upstream DAO donor qualification;
- Ruff and mypy (tools unavailable in this environment);
- live GitHub/provider qualification;
- external WORM/Object-Lock anchoring;
- production workload identity / KMS/HSM / attestation;
- production native-kernel promotion.

## Security interpretation

`workload_identity_local=PASS` proves the code can bind a worker credential to worker, subject,
environment, release, expiry, and worker public key; require that credential before execution; and
emit signed execution evidence. It does not prove production key custody or workload attestation.

`external_anchor_local=PASS` proves signed checkpoint chaining, environment/release binding,
append-only local persistence semantics, and tamper rejection. It does not prove that a remote
service is administratively independent or WORM.
