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

- Source qualification: **177 total / 175 passed / 2 skipped / 0 failed**.
- Source-integrity verifier: **PASS**.
- Source manifest SHA256: `34a25fbb1302c174b40b61d40b67272f9b3f5be01c0d3e1d5f75638d8c90c0e5`.
- Source tar: `effect-fabric-0.2.12.tar.gz`
  (`sha256: 0506c53627b7dfd29894e7bc91c80e36fe6f6b86b2f2e68484b77b459f0fa837`).
- Wheel: `effect_fabric-0.2.12-py3-none-any.whl`
  (`sha256: 4b13067d8069080862772bc8ca23700cd6ed9123550c1003e1c8574d2b44d19b`).
- Wheel payload audit: **PASS** (`artifacts/WHEEL_CONTENTS_CHECK.json`).
- Wheel/source equivalence: **PASS** with **73 compared files** and **0 failures**
  (`artifacts/WHEEL_SOURCE_EQUIVALENCE.json`).
- Installed-wheel smoke: **PASS** (`verification/INSTALLED_WHEEL_SMOKE.json`).
- Installed-wheel CLI demo: **PASS** (`verification/INSTALLED_WHEEL_DEMO.json`).
- Root runtime suite: **25 passed**.
- Root adapter live suite: **7 passed**.
- Root cross-language suite: **14 passed** against the installed wheel from a clean virtualenv; the
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
