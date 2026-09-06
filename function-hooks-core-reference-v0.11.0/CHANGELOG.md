# Changelog

## 0.11.0

- Added `@function-hooks/capabilities` with canonical capability descriptors, discovery candidates, admitted capabilities, deterministic SHA-256 schema/descriptor/candidate fingerprints, and immutable snapshots.
- Added explicit admission evidence binding `admissionId`, `policyVersion`, candidate hash, and descriptor hash. Discovery candidates have no routing authority.
- Added `InMemoryCapabilityRegistry` with active/suspended/revoked/superseded lifecycle; revoked/superseded states are terminal.
- Added `CapabilityRegistryPersistence`/snapshot interfaces as the contract for later durable registry backends.
- Added safe agent-catalog projection from active registry records; backend implementation, provenance, and admission internals are not exposed.
- Added automatic `AdmittedCapability -> CapabilityRoute` compilation for MCP, HTTP, browser, desktop, process-profile, and filesystem implementations.
- Added `createExecutionRouterFromRegistry()` while retaining manual routes.
- Added trusted generated-route metadata for capability/admission identity that caller metadata cannot overwrite.
- Added 10 capability/registry/router tests covering deterministic hashing, schema drift, cross-connector identity, raw-candidate rejection, terminal registry states, catalog filtering, generated routing, metadata anti-forgery, manual-route coexistence, and structured HTTP compilation.
- Changed the top-level test runner to execute each compiled test file in its own Node test process, sequentially, to isolate cross-process hardening fixtures and avoid pathological lock-contention/open-handle interactions between files. Product concurrency semantics are unchanged.
- Kernel semantic contract remains frozen at `1.0-rc.1`.

## 0.10.0

- Added crash-recoverable cross-process lock/reload transactions to `FileActionReceiptStore`; separately opened processes now coordinate claims against one journal.
- Added the same cross-process coordination to `DurableAuditJournal`, plus `refresh()` for explicitly synchronizing an opened instance with durable state.
- Same-host lock recovery detects dead owner PIDs immediately; remote/malformed locks remain guarded by a configurable stale timeout.
- Node process execution now defaults to an isolated POSIX process group and kills the group on timeout/cancellation/output-limit escalation, covering ordinary descendants rather than only the direct child.
- Added configurable process kill grace and direct-child compatibility mode.
- Added descriptor-anchored Linux filesystem mode using opened parent/file descriptors, `O_NOFOLLOW`, regular-file checks, read/write caps, fsynced temporary files, and atomic rename.
- Added `filesystemSecurity: auto|required|legacy`; `required` fails closed when descriptor anchoring is unavailable.
- Replaced `fetch` network execution with pre-resolved, address-pinned Node HTTP(S) requests. Private, loopback, link-local, multicast, documentation, benchmark, reserved, mapped IPv4, and NAT64 ranges are denied by default.
- Added explicit `networkAllowPrivateAddresses` for trusted/local test deployments, request-body caps, and embedded-credential rejection.
- Added real multi-process receipt/audit qualification, descendant process-kill qualification, secure filesystem qualification, stale-lock recovery, and DNS/IP SSRF regressions.
- Frozen `1.0-rc.1` kernel semantics are unchanged.

## 0.9.3

- Fixed reference and portable runtimes so throwing trace observers are observational only and cannot alter dispatch success/failure semantics.
- Fixed action receipts for successful `undefined`/void results; completed void actions now replay safely after file-store reopen.
- Receipt completion now stores immutable canonical snapshots rather than caller-owned mutable result references.
- File receipt recovery now verifies persisted `resultHash` values and rejects invalid state transitions instead of accepting last-write-wins corruption.
- Canonical JSON now rejects exotic object instances (`Date`, `Map`, `Set`, class instances) instead of collapsing them into ambiguous plain-object hashes.
- Policy rewrites are cloned/frozen before approval so approval callbacks cannot mutate already-validated execution input.
- Gateway allowlist and Node host-adapter authority configuration is snapshotted at construction; later mutation of caller-owned arrays/objects cannot silently broaden authority.
- Process profile configuration now validates fixed arguments, environments, timeout/output limits, and host limit fields at adapter construction.
- Timed-out/cancelled/output-limited child processes now escalate from `SIGTERM` to `SIGKILL` after a short grace period if they refuse to exit.
- Added focused regressions for all above defects while preserving the frozen `1.0-rc.1` kernel contract and public TypeScript API snapshots.

## 0.9.2

- Added `@function-hooks/router`, a reusable `(app, capability)` routing layer above the gateway.
- Standardized execution backend classes: MCP, HTTP/API, browser, desktop, and local filesystem/process.
- Added `desktop.call` to the gateway, blueprint, validation, receipts, host adapter callback, and application-scoped allowlist policy.
- Router owns and injects `actionId`; route builders that attempt to forge it fail closed.
- Added protected route provenance metadata for app, capability, and backend.
- Added backend/event consistency validation and duplicate-route rejection.
- Added declarative helpers for MCP, API, browser, desktop, process, file-read, and file-write capabilities.
- Added eight router integration/security tests and a runnable execution-router demo.
- Kept frozen `1.0-rc.1` kernel semantics unchanged.

## 0.9.1

- Fixed a concurrent-claim race in `FileActionReceiptStore` by serializing the complete state transition.
- Fixed concurrent `DurableAuditJournal.append()` chain forking by serializing head selection through fsync/publication.
- Receipt/audit file stores now poison the opened instance after a persistence failure so later writes cannot build on uncertain disk state.
- Added named `ProcessProfile` capabilities with fixed args, caller-arg validation, cwd roots, explicit environments, timeout/output caps, and optional executable SHA-256 pins.
- Node process children no longer inherit the gateway host environment.
- Deprecated raw process command execution is denied unless `allowLegacyProcessCommands: true` is explicitly set.
- Policy rewrites may no longer change `actionId`; violations fail as `GatewayInvalidRewriteError`.
- Added 100-way receipt contention, 100-way same-action gateway contention, 1,000-way audit append stress, environment-leak, arbitrary-argument, legacy-opt-in, and immutable-action-ID regression tests.
- Kernel semantics remain frozen at `1.0-rc.1` with fingerprint `aef14d3c4b77d9874496d0d020241ec976b9b038c8d2274c1e0c6bfd1939c708`.

## 0.9.0

Added `@function-hooks/gateway`, a fail-closed real agent-action gateway over the frozen kernel contract. Added explicit MCP/browser/filesystem/process/network events, policy rewrite and approval hooks, action-receipt composition, execution audit, Node host adapters with independent filesystem/process/network restrictions, streamed network response caps, cooperative cancellation, and hostile end-to-end qualification. Kernel `1.0-rc.1` semantics are unchanged.

## 0.8.0

- Froze the existing 21-case `1.0-rc.1` kernel semantics with a machine-checked SHA-256 contract snapshot.
- Added normalized TypeScript declaration/API snapshots for the umbrella and all ten scoped packages.
- Removed legacy compatibility symbols and runtime shims from the umbrella root; compatibility now requires the explicit `/compat` subpath or `@function-hooks/compat`.
- Removed the unused Node ambient shim from `@function-hooks/portable`.
- Added ES2022+DOM compile qualification for portable with `types: []` and a source gate rejecting Node runtime primitives.
- Added deterministic cross-runtime differential qualification across 256 generated hook chains and 768 dispatches.
- Added v0.8 migration guidance and an explicit runtime support matrix.

## 0.7.0

- Added `@function-hooks/portable`, a second independently implemented kernel runtime using explicit dispatch-frame propagation instead of `AsyncLocalStorage`.
- Enforced that portable runtime source has only type-level imports from `@function-hooks/core` and cannot reuse reference-runtime implementation helpers.
- Removed the conformance harness's use of the reference `createBlueprint()` helper; fixtures now use only the public `EngineBlueprint` contract.
- Expanded the public black-box conformance suite from 18 to 21 cases and labeled it `1.0-rc.1`.
- Qualified both reference and portable implementations at 21/21 conformance cases.
- Added matcher array semantics, immutable continuation metadata, and default runtime deadline to the executable contract.
- Added portable standard-event composition, dual-runtime result/trace equivalence, and portable conformance demos.
- Extended workspace linking, package boundaries, packaging, SBOM, evidence, and offline consumer qualification for the tenth scoped package.

## 0.6.0

- Moved the deprecated schema-bearing `FunctionHooksRuntime`, wildcard hooks, `engine.create`, and `registerCorePlugin()` into a dedicated `@function-hooks/compat` package.
- Reduced umbrella legacy runtime sources to machine-checked re-export shims.
- Added `runKernelConformance()` under `@function-hooks/core/conformance`, covering 18 observable candidate-1.0 semantic cases.
- Added `createStandardKernel()` to `@function-hooks/events` as the short stable replacement for legacy core bootstrap.
- Added compatibility-package composition tests and direct umbrella-to-compat identity tests.
- Extended the package DAG, clean-checkout linker, packaging, docs, and release evidence for the ninth scoped package.
- Declared compat removal from the umbrella at 1.0; compatibility semantics remain outside the stable kernel promise.

## 0.5.0

- Extracted assurance, audit, replay, plugins, isolation, and enterprise into independent workspace packages.
- Enforced a one-way package dependency DAG.
- Replaced higher-layer imports of `FunctionHooksRuntime` with structural compatibility ports.
- Added exact-event stable-kernel adapters for receipts, audit, replay, origin policy, plugin registration, and isolation dispatch.
- Added stable blueprint blast-door filtering without `engine.create`.
- Kept wildcard and `engine.create` behavior compatibility-only; core semantics remain narrow.
- Added package-composition tests and a split-package demo.


## 0.4.0

Kernel-boundary migration release.

Added:

- independent `@function-hooks/core` workspace package with no dependency on assurance/audit/replay/isolation/plugins/enterprise;
- `@function-hooks/events` optional standard event catalog and host-adapter blueprint;
- typed `createKernel()` builder, `Runtime`, `EngineBlueprint`, `createBlueprint()`, lifecycle, caller cancellation, optional dispatch deadlines, deterministic traces, and stable semantic error classes;
- strict one-shot `next()` semantics in the new kernel;
- immutable event cloning/freezing with explicit rejection of exotic mutable containers;
- blueprint snapshotting so caller mutation after `defineEngine()` cannot alter the published engine;
- black-box kernel conformance suite and exported golden three-hook trace;
- package-boundary checker that fails if core imports higher layers;
- compatibility umbrella subpaths `/kernel` and `/events`;
- migration ADR, package-boundary status, and 0.4 migration guide.

Compatibility:

- the v0.3 `FunctionHooksRuntime`, assurance, audit, isolation, replay, plugin, and enterprise implementation remains available in the umbrella package for the 0.4 line;
- `FunctionHooksRuntime` and `registerCorePlugin()` are deprecated but functional;
- the legacy 34-test suite continues to pass unchanged.

Intentionally deferred to 0.5:

- source migration of assurance/isolation/audit/replay/plugins/enterprise into independently publishable packages;
- removal of the assurance-coupled compatibility runtime;
- any claim that the full old source graph has already been package-separated.

## 0.3.0

Production-hardening release built on v0.2.0.

Added:

- explicit per-plugin capability grants for isolated `$` access;
- denied capabilities absent from child proxy and independently rejected by host;
- generic process isolation launch builder;
- ready-to-use rootless Podman isolation loader/launch plan;
- durable fsync-capable hash-chain audit journal with recovery verification;
- persistent exactly-once-or-detect action receipt store and policy plugin;
- semantic event schema versions, negotiation, and migration registry;
- core event schema version metadata (`1.0.0`);
- deterministic replay recorder/log/verifier for pure/mock qualification;
- transactional runtime generation publication, leases, draining, and activation receipts;
- audit verification CLI helper;
- expanded production-hardening qualification suite.

Behavioral change:

- isolated plugins now receive **no engine capability grants by default**. Callers must explicitly grant events such as `ui.log`.

Still intentionally not claimed:

- Podman/Firecracker/gVisor hostile-code proof;
- multi-host exactly-once semantics;
- full UI reconciliation;
- arbitrary schema-compatible hot upgrades.

## 0.2.0

Assurance-hardening release.

Added runtime schemas/budgets, non-idempotent continuation limits, sealed managed config, plugin digest admission, symlink checks, tamper-evident audit, isolated process RPC, restrictive imports, host-bound origin, and resource limits.
