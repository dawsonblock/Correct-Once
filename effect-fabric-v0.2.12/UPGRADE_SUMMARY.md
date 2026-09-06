# Effect Fabric v0.2.12 — Upgrade Summary

## Why the bump was required

The 0.2.11 line had been modified in source while its sealed wheel/sdist evidence still reflected
the older gateway contract. This release moves those Correct-Once gateway and trusted-write-identity
changes into a clean 0.2.12 lineage and refreshes the provenance chain from source inputs through
the built artifacts.

## What changed

- Versioned the vendored Effect Fabric tree as **0.2.12** instead of continuing to patch 0.2.11.
- Added explicit `semantic_metadata` support to the gateway contract and `ActionIntent` so
  trusted-action identity distinguishes semantic drift while ordinary request metadata stays
  non-semantic by default.
- Hardened release build plumbing so the vendored qualification uses the configured Python
  interpreter, the package metadata builds cleanly under current setuptools, and root qualification
  creates a clean virtualenv for the installed-wheel cross-language proof.
- Added `WHEEL_SOURCE_EQUIVALENCE.json` to prove the built wheel payload matches the frozen 0.2.12
  source tree byte-for-byte for all packaged Python and shared runtime assets.

## Verification highlights

- `make qualify`: **PASS**
- `bash scripts/qualify.sh`: **176 tests / 174 passed / 2 skipped / 0 failed**
- `python3 scripts/verify_release_integrity.py`: **PASS**
- Installed-wheel cross-language suite: **13 passed**, with the harness proving
  `effect_fabric==0.2.12` was imported from `site-packages`
- Source tar SHA256:
  `4a2f49b20ca835e67dbca7d4b51e35262450d8cf35eddaa81d3847ca12e39b21`
- Wheel SHA256:
  `dfe150347ec379df84ab6bd6bc26dad089dbda3c921f7738f4475de88ec49cd6`
- Wheel/source equivalence: **72 compared files / 0 failures**

## Still not claimed

- PostgreSQL durability and crash/fencing qualification remain **NOT_RUN** locally.
- External WORM/Object-Lock anchoring remains **NOT_RUN**.
- Production workload identity / KMS / attestation remains **NOT_RUN**.
- This branch does **not** claim `RELEASE_QUALIFIED` or production packaging readiness.
