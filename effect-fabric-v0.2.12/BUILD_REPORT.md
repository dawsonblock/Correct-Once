# Effect Fabric v0.2.12 — Final Artifact Verification

**Release:** `0.2.12-trust-boundary-hardening`  
**Date:** 2026-09-06  
**Release posture:** `REFERENCE_QUALIFIED`

## Commands run

- `make qualify`
- `bash scripts/qualify.sh`
- `python3 scripts/freeze_release.py`
- `python3 scripts/verify_release_integrity.py`
- `python3 scripts/build_release.py`

## Results

- Source qualification: **176 total / 174 passed / 2 skipped / 0 failed**.
- Source-integrity verifier: **PASS**.
- Source manifest SHA256: `bc4b56d9682d1efca651e4768f7a1f003b9a807f5eb25c52ee838e09f17c69fe`.
- Source tar: `effect-fabric-0.2.12.tar.gz`
  (`sha256: fa50c406f77e1d2261bfa892a0de438843c800e249e753ffb9475db9df64fed0`).
- Wheel: `effect_fabric-0.2.12-py3-none-any.whl`
  (`sha256: dfe150347ec379df84ab6bd6bc26dad089dbda3c921f7738f4475de88ec49cd6`).
- Wheel payload audit: **PASS** (`artifacts/WHEEL_CONTENTS_CHECK.json`).
- Wheel/source equivalence: **PASS** with **72 compared files** and **0 failures**
  (`artifacts/WHEEL_SOURCE_EQUIVALENCE.json`).
- Installed-wheel smoke: **PASS** (`verification/INSTALLED_WHEEL_SMOKE.json`).
- Installed-wheel CLI demo: **PASS** (`verification/INSTALLED_WHEEL_DEMO.json`).
- Root runtime suite: **24 passed**.
- Root adapter live suite: **3 passed**.
- Root cross-language suite: **13 passed** against the installed wheel from a clean virtualenv; the
  harness confirmed `effect_fabric_version=0.2.12` from `site-packages`.
- Function Hooks manifest verification: **PASS**.

## Explicit NOT_RUN gates

- `postgres_live` / `postgres_crash_fencing`;
- upstream DAO donor qualification/reproducibility;
- live GitHub/provider fault qualification;
- external WORM/Object-Lock anchoring;
- production workload identity / KMS / attestation;
- production native-kernel promotion;
- Ruff and mypy within the vendored release qualification.

## Residual honesty boundary

This bundle closes the 0.2.11 provenance mismatch and proves the 0.2.12 source tree matches its
built wheel, but it does **not** make a production packaging or `RELEASE_QUALIFIED` claim.
