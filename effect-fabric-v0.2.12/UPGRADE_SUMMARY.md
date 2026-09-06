# Effect Fabric v0.2.11 — Trust Boundary Hardening

This release advances v0.2.10 without changing its core gateway model. It adds locally qualified
cryptographic workload identity and externally placeable signed evidence anchors while preserving
fail-closed production qualification semantics.

## Added

- Ed25519 `WorkloadAuthority`, `WorkloadCredential`, `WorkloadSigner`, `WorkloadAssertion`, and
  `WorkloadVerifier`.
- Optional `EffectEngine(require_workload_identity=True)` enforcement before capability consumption.
- Worker credentials bound to worker ID, subject, environment, release, public key, and expiry.
- Signed start, attempt-bound, and outcome assertions in the execution evidence path.
- Workload credential ID/digest persisted on execution attempts.
- PostgreSQL migration `007_workload_identity.sql`.
- Environment/release-bound ledger anchors.
- `DirectoryAnchorStore` using exclusive per-anchor files and directory fsync.
- `HttpAnchorStore` for an independently administered remote anchor service.
- Source-bound `workload_identity_local` and `external_anchor_local` qualification gates.

## Verified

- Source qualification: 172 passed, 2 live-PostgreSQL skips.
- Local workload identity: PASS.
- Local external anchor mechanics: PASS.
- Canonical transition kernel: PASS.
- Effect Gateway: PASS.
- Source integrity: PASS.
- Extracted sdist: 174 tests total, 172 passed and 2 skipped.
- Isolated wheel identity-required execution: PASS.
- Installed-wheel ledger verification: PASS.
- Installed-wheel CLI demo: PASS.
- Wheel deployment assets including migration 007: PASS.

## Deliberately not claimed

The release remains `REFERENCE_QUALIFIED`. A local Ed25519 credential test is not a production
KMS/HSM or workload-attestation qualification, and a local/HTTP anchor adapter is not proof of
WORM/Object-Lock immutability. Those production gates remain `NOT_RUN` until exercised against the
actual deployment systems.
