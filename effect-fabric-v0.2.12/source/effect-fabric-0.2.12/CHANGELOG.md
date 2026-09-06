# Changelog

## 0.2.12 — 2026-09-06

- Moves the trusted gateway identity and release-provenance changes out of the sealed 0.2.11 line
  into a clean 0.2.12 release tree.
- Adds explicit `semantic_metadata` handling so governed replays distinguish semantic drift without
  leaking metadata into provider arguments.
- Rebuilds qualification inputs, frozen source manifests, and wheel/sdist artifacts from the 0.2.12
  source tree.

## 0.2.11 — 2026-09-05

- Added Ed25519 workload authority, worker credentials, per-worker signing keys, and assertion verification.
- Added optional `require_workload_identity` enforcement before capability consumption.
- Bound workload credentials to worker, subject, environment, release, public key, and expiry.
- Persisted workload credential ID/digest on execution attempts and coupled signed start/outcome assertions to evidence.
- Added migration `007_workload_identity.sql`.
- Bound ledger anchors to environment and release identity.
- Added exclusive one-file-per-checkpoint `DirectoryAnchorStore` and SDK-free `HttpAnchorStore`.
- Added source-bound local workload-identity and external-anchor qualification gates.
- Kept `production_workload_identity` and `external_worm_anchor` fail-closed as `NOT_RUN` without real production prerequisites.
- Retained v0.2.10 Effect Gateway, v0.2.9 fencing hardening, and v0.2.8 canonical transition algebra.

## 0.2.10 — 2026-09-05

- Added SDK-neutral Effect Gateway for routing registered MCP reads and governed mutations.
- Added EffectRegistryV3 and dynamic EffectDefinitionFactory binding per-call resources/contracts/idempotency.
- Added independent gateway policy/approval boundary with deny-all secure default.
- Added generic MCP mutation executor with schema pinning and pre-effect revalidation.
- Unknown tools, including unknown read-only hints, now fail closed by default at the gateway.
- Added optional authenticated gateway HTTP service wrapper.
- Added gateway qualification, integration tests, and an end-to-end example.
- Retained v0.2.9 PostgreSQL crash/fencing hardening and v0.2.8 canonical transition algebra.

## 0.2.9 — 2026-09-04

- Split original attempt completion from reconciliation settlement so old/orphaned workers cannot
  finalize by presenting a newer transaction fence.
- Require transaction fence, attempt fence, active attempt state, and original lease owner for
  normal provider-result finalization.
- Reject non-zero initial fencing epochs and generic persistence attempts that rewrite/mint a
  fencing epoch.
- Added `finalize_reconciliation_transition` for current-fence settlement of `UNKNOWN`/`ORPHANED`
  attempts.
- Added PostgreSQL partial unique index `one_active_attempt_per_transaction`.
- Added per-claim UUID `claim_token` fencing to the evidence outbox and bound ACK/release operations
  to the exact claim instance.
- Added migration `006_postgres_fencing_claim_tokens.sql`.
- Expanded the live PostgreSQL failure matrix with process-kill boundaries after STARTED commit,
  external-effect commit, receipt commit, outbox claim, and ledger append-before-ACK.
- Upgraded PostgreSQL qualification to schema v2; a live PASS now requires zero skipped tests.
- Added explicit `postgres_crash_fencing` release gate and wheel payload verification for migration
  006.
- Preserved the v0.2.8 canonical transition algebra and v0.2.7 source-bound release evidence.

## 0.2.8 — 2026-09-04

- Added `spec/effect-transition-v1.json` and schema/invariant documents as the canonical structural execution-state algebra.
- Added deterministic generated Python and TypeScript transition tables with a locked spec SHA-256.
- Added `effect_fabric.transition_kernel` with command-aware decisions, terminal-state protection, and generic legal-edge validation.
- Centralized production execution-state mutation through the kernel and added AST qualification that rejects direct runtime writes outside it.
- Added defence-in-depth illegal-edge rejection to in-memory and PostgreSQL persistence paths.
- Bound the Python pure reducer to the same canonical legal-edge table.
- Added explicit durable-agent-outbox status crosswalk with fail-closed unknown-status handling.
- Added source-bound `TRANSITION_KERNEL_QUALIFICATION.json` release gate.
- Added canonical spec/generated table payload checks to wheel qualification.
- Preserved v0.2.7 source/evidence binding, native DAO kernel, provider hardening, packaging, and provenance controls.

## 0.2.7 — 2026-09-04

- Added deterministic qualification-input manifests and source-bound evidence provenance.
- Made stale or unbound qualification PASS records fail closed during release aggregation, freeze, and integrity verification.
- Replaced the hard-coded core-test PASS gate with a pytest/JUnit-derived gate.
- Regenerate missing upstream-donor gates as current-run `NOT_RUN` instead of retaining historical PASS JSON.
- Reject unmanifested source files during release-integrity verification.
- Ship migrations, native DAO bridge/kernel assets, and third-party license notices in the wheel.
- Added explicit MIT attribution for the `durable-agent-outbox`-derived native reducer.
- Hardened native `ATTEMPT_RESULT`, ACK epoch, and pending-withdrawal epoch validation.
- Added GitHub prepared-ETag revalidation before issue-label mutation.
- Added regression tests for stale evidence, provider TOCTOU refusal, and transition-kernel hardening.

## 0.2.6 — 2026-09-04

- Added a checked-in Effect Fabric native durable-effect transition kernel.
- Redirected the newest direct DAO scheduler path away from donor `reduce.js`.
- Added donor-reducer poisoning during official conformance qualification.
- Added native-kernel call instrumentation and independent source fingerprinting.
- Added official upstream 17-scenario qualification for the native kernel path.
- Added native-kernel reproducibility and release-status gates.
- Preserved v0.2.5 active scheduler, store, shadow, provider, evidence, and mutation gates.
- Kept production `EffectEngine` promotion explicitly out of scope until further qualification.

## 0.2.5 — 2026-09-04

- Removed the donor `OutboxWorker` class from the direct active conformance path.
- Added `EffectFabricActiveScheduler`, derived deterministically from the locked MIT donor scheduler source.
- Added Effect Fabric pre-commit invariant enforcement before every compatibility-store CAS commit.
- Official durable-agent-outbox suite passes 17/17 through the active scheduler path.
- Exercised 163 pre-commit guard checks and 78 post-operation invariant observations.
- Added active-path reproducibility qualification.
- Kept the donor pure `reduce()` transition oracle explicit as the next promotion boundary.

## 0.2.4 — 2026-09-04

- Added Effect Fabric-owned SQLite implementation of the donor OutboxStore contract.
- Added TypeScript→JSONL→Python direct conformance bridge.
- Official durable-agent-outbox suite passes 17/17 against the Effect Fabric store adapter.
- Added adapter CAS, atomic action+audit, restart, two-connection, and reproducibility tests.
- Split donor direct-store PASS from still-NOT_RUN direct active-engine conformance.

## 0.2.2 — 2026-09-04

### Upstream durable-agent-outbox conformance bridge

- Added offline compilation/execution of the exact locked durable-agent-outbox `core` and
  `conformance` packages.
- Added execution of the donor public `runConformance()` API without requiring pnpm or Vitest.
- Official upstream reference harness: 17/17 scenarios pass.
- Official upstream mutant suite: all 8 mutants fail every declared required scenario.
- Added package-level source locks for donor core/conformance trees and package metadata.
- Added fail-closed scenario/mutant crosswalk validation against Effect Fabric's internal semantic
  conformance port.
- Added upstream inventory-drift tests.
- Preserved v0.2.1 runtime/reducer equivalence and internal negative controls.
- Kept the active engine in place; a direct upstream `ConformanceHarness` backed by Effect Fabric
  runtime storage remains a separate promotion gate.

## 0.2.1 — 2026-09-04

- Added active-runtime/pure-reducer common-trace equivalence qualification.
- Added eight internal deliberately broken reducer variants and mutation-discrimination gates.
- Aligned prepare-before-authorize ordering and strengthened receipt replay/redelivery semantics.

## 0.2.0 — 2026-09-04

- Added donor compatibility foundation, pure reducer scaffold, provider-effect profiles, MCP Effect
  Registry v2, ChronoMCP compensation metadata, AgentAction authorization evidence compatibility,
  and PALO Effect Contract import.

## 0.1.6 — 2026-09-03

- Added explicit release qualification, reproducible evidence handling, PostgreSQL failure-matrix
  tests, outbox observability, and release integrity tooling.
