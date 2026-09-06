# Effect Fabric v0.2.12 — Build and Qualification Report

**Release:** `0.2.12-trust-boundary-hardening`  
**Date:** 2026-09-06  
**Posture:** `REFERENCE_QUALIFIED`

## Why 0.2.12 exists

This release moves the Correct-Once gateway and trusted-write-identity changes out of the sealed
0.2.11 line into a clean 0.2.12 source tree, then rebuilds the qualification inputs, source
manifest, release manifest, sdist, wheel, and source-to-wheel evidence from that tree.

## Commands and results

- `bash scripts/qualify.sh` -> **176 tests / 174 passed / 2 skipped / 0 failed**.
- `python3 scripts/freeze_release.py` -> refreshed `MANIFEST.sha256` and `release-manifest.json`.
- `python3 scripts/verify_release_integrity.py` -> **PASS**.
- `python3 scripts/build_release.py` -> rebuilt the source tar and wheel; exact artifact digests are
  recorded in `release-artifacts/artifact-manifest.json`.
- `release-artifacts/WHEEL_CONTENTS_CHECK.json` -> **PASS**.
- `release-artifacts/WHEEL_SOURCE_EQUIVALENCE.json` -> **PASS** with **72 compared files** and
  **0 failures**.

## Qualified local gates

- `core_tests`, `provider_local`, `evidence_local`, `transactional_evidence_local`,
  `canonical_transition_kernel`, `effect_gateway_local`, `workload_identity_local`,
  `external_anchor_local`, `reducer_equivalence_local`, `reducer_negative_controls`, and
  `qualification_reproducibility_local`: **PASS**.
- `postgres_live` and `postgres_crash_fencing`: **NOT_RUN** because `psycopg` and a live DSN were
  not present.
- Upstream DAO donor, live GitHub/provider, external WORM anchoring, production workload identity,
  and production native-kernel promotion gates: **NOT_RUN**.

## Honesty boundary

Passing these local gates proves the 0.2.12 source tree, manifest, and built artifacts are aligned
for this reference environment. It does **not** claim production WORM storage, KMS/HSM-backed
workload identity, live PostgreSQL durability, `RELEASE_QUALIFIED`, or production packaging.
