> **0.11.0 capability-registry upgrade:** the frozen `1.0-rc.1` kernel remains unchanged. This release separates discovered capability candidates from admitted/routable capabilities, adds deterministic schema/descriptor/provenance fingerprints, an explicit registry lifecycle, safe agent-catalog projection, and automatic Router compilation from active admitted capabilities.

# Function Hooks Core Reference v0.11.0
Independent production-hardening reference implementation of the architecture described in **“Function Hooks: Core Architecture” (Alice Poteat, Anthropic, August 2026)**.

This repository is **not Anthropic code, not an official Claude Code runtime, and not evidence that the proposal has shipped**. It is an executable interpretation of the hook algebra plus explicitly marked assurance, isolation, audit, replay, plugin, and enterprise extensions.

## v0.8.0: contract freeze and release-surface control

Version 0.8 stops expanding the kernel and starts enforcing what 1.0 will mean.

- Frozen the existing **21-case `1.0-rc.1` semantics** with a SHA-256 contract snapshot over the semantics document, case names, and canonical golden trace. Silent edits now fail `npm run semantics:check`.
- Added normalized TypeScript declaration snapshots for the umbrella and all ten scoped packages. Accidental public API drift now fails `npm run api:check`.
- Removed legacy `FunctionHooksRuntime`, `registerCorePlugin`, wildcard/runtime shims, and `engine.create` symbols from the umbrella **root** surface. Compatibility is available only from the explicit `/compat` subpath or `@function-hooks/compat`.
- Removed the unused Node ambient shim from `@function-hooks/portable` and added a Web/DOM-oriented compile gate with `types: []`, plus a source scan rejecting Node runtime primitives.
- Added a deterministic **256-chain / 768-dispatch differential campaign** comparing reference and portable results and observable traces.
- Retained dual implementation qualification: both runtimes pass **21/21** public conformance cases using different recursion-context mechanisms.

The browser/worker compile gate is structural evidence, not a claim that browser, Deno, or Bun execution has been run. Those hosts remain outside the verified runtime matrix.

## v0.11.0: admitted capability registry and automatic routing

v0.11.0 moves route setup from handwritten functions toward a controlled discovery/admission pipeline. The new `@function-hooks/capabilities` package defines immutable `CapabilityCandidate` and `AdmittedCapability` records, canonical schema and descriptor hashing, connector-bound candidate fingerprints, an in-memory lifecycle registry, a durable-registry persistence interface, and a safe agent-facing catalog projection that omits backend implementation details.

Discovery evidence has zero execution authority. Only admitted capabilities can enter the registry, and `@function-hooks/router` can compile routes only from valid active admission records. Generated routes bind capability/admission hashes into trusted metadata after caller metadata, so an agent cannot forge admission provenance. Manual routes remain supported for specialized mappings. The registry is currently snapshot-based at router construction; live route invalidation and automatic connector rediscovery are intentionally deferred to later releases. Admission hashes provide integrity binding, not signer authentication; signed admission policy is also deferred.

## v0.10.0: cross-process and host-boundary hardening

v0.10.0 keeps the `1.0-rc.1` kernel semantics frozen and hardens the Node execution boundary. File-backed action receipts and durable audit journals now use crash-recoverable exclusive lock files, reload durable state while holding the lock, and coordinate separately opened instances/processes on the same filesystem. Same-host dead-owner locks are recovered using PID liveness.

The Node gateway now defaults to process-group execution on POSIX and escalates termination across the group, so ordinary child/grandchild processes do not survive timeout/cancellation. Linux filesystem operations can use descriptor-anchored `/proc/self/fd` paths with `O_NOFOLLOW`, regular-file checks, byte caps, fsynced temporary writes, and atomic replacement; `filesystemSecurity: "required"` fails closed if that mechanism is unavailable. Network requests now resolve DNS before connect, reject private/loopback/link-local/reserved answers by default, pin the socket lookup to the checked address, reject embedded URL credentials, bound request bodies, and still refuse automatic redirects.

These controls improve the in-process Node host boundary; they are not a substitute for container/microVM isolation, a distributed database, or network namespace enforcement.

## v0.9.3: bug-fix and integrity hardening

v0.9.3 is a correction release over the v0.9.2 router/gateway architecture. Trace callbacks are now truly observational in both kernel implementations; receipt stores handle void results, snapshot replay values, and validate persisted result hashes/state transitions; canonical hashing rejects exotic object instances; gateway rewrites are frozen before approval; host/policy security configuration is snapshotted at construction; and child-process timeout/cancellation/output-limit paths escalate to `SIGKILL` if `SIGTERM` is ignored.

The public 21-case `1.0-rc.1` semantic fingerprint and normalized TypeScript declaration snapshots remain unchanged. The fixes are covered by dedicated regressions in addition to the existing qualification suite.

## v0.9.2: reusable application-capability routing

Version 0.9.2 addresses the scaling problem above the gateway: applications should not each require their own Function Hooks integration. The new `@function-hooks/router` package maps `(app, capability)` declarations onto five reusable backend classes: MCP, HTTP/API, browser, desktop/computer control, and local filesystem/process execution. Unknown routes fail closed, duplicate routes are rejected, the router owns `actionId`, and route provenance metadata cannot be forged by the caller.

The gateway adds `desktop.call` as an abstract event with application-scoped allowlisting and an explicit host callback. This does **not** ship a universal desktop automation engine or grant UI control automatically. Every routed action still passes through gateway authorization, approval, receipts, audit, cancellation, and host-local enforcement.

Qualification adds eight router-specific tests and an end-to-end route demo while the frozen kernel semantic fingerprint remains unchanged.

## v0.9.1: gateway correctness hardening

Version 0.9.1 keeps the frozen `1.0-rc.1` kernel unchanged and repairs concrete gateway/storage defects found after the first real-action release. `FileActionReceiptStore` now serializes complete state transitions so simultaneous claims in one process cannot execute the same side effect twice. `DurableAuditJournal` serializes head selection through append/fsync/publication so concurrent callers cannot fork the hash chain.

Node process execution now defaults to named **process capability profiles** instead of raw executable allowlisting. Profiles bind an absolute executable to host-owned fixed arguments, optional caller-argument validation, a working-directory root, explicit environment variables, timeout/output caps, and an optional executable SHA-256 pin. The gateway never inherits the parent process environment. Raw command execution is retained only as an explicitly enabled deprecated compatibility path. Policy rewrites are also forbidden from changing `actionId`.

Qualification adds 100-way receipt contention, 1,000 concurrent durable-audit appends, 100 simultaneous gateway dispatches sharing one action ID, process-environment leak checks, arbitrary-argument denial, and immutable action-ID rewrite tests.

## v0.9.0: real agent-action gateway

Version 0.9 moves validation from synthetic middleware fixtures into a production-shaped action path. `@function-hooks/gateway` exposes explicit `mcp.call`, `browser.call`, `fs.read`, `fs.write`, `process.exec`, and `network.request` events. It defaults to deny-all, can require approval, revalidates policy rewrites, composes retry-safe action receipts and execution audit, and executes through adapters that receive the dispatch `AbortSignal`.

The Node adapter adds an independent host boundary: realpath filesystem containment, symlink-escape rejection, `shell: false` process spawning, exact command/origin/method allowlists, timeout/output caps, redirect suppression, streamed response-size enforcement, and explicit MCP/browser callbacks. Host policy remains separate from kernel origin labels, which are diagnostic only.

The `1.0-rc.1` kernel semantic fingerprint remains unchanged.

## Architectural thesis

The paper's important idea is not merely “function hooks.” The engine interface `$` is the capability surface. Every `$.noun.event(input)` call is also a hookable event. Hooks compose as Koa-style continuations `($, e, next)`, so one algebra expresses before/after behavior, modification, replacement, concurrency, policy, auditing, UI wrapping, and engine extension.

The security consequence is that **order is authority**: earlier hooks wrap later hooks and can inspect, rewrite, suppress, or repeat lower execution. Managed plugin order is therefore part of the trusted computing base.

The distribution retains legacy v0.x behavior only through the explicit `@function-hooks/compat` package or `/compat` subpath. The umbrella root itself now exposes only the stable-candidate kernel and higher-layer packages.

## v0.3.0 additions

### Explicit per-plugin capability grants

Isolated plugins no longer receive a dynamically open `$` proxy by default. The default grant set is empty.

- exact grants: `ui.log`
- noun grants: `fs.*`
- global grant: `*`
- denied nouns/events are absent from the child proxy
- the host independently re-checks every isolated engine RPC
- plugin origin remains host-bound and cannot be supplied by child code

Example:

```ts
const loader = new NodePermissionProcessLoader(runtime, {
  capabilityGrants: (pluginName) => pluginName === "renderer"
    ? { events: ["ui.log", "ui.render", "model.call"] }
    : { events: [] },
})
```

### OS/container-backed launch path

The same RPC protocol can now be launched through a pluggable `IsolationLaunchBuilder`. A ready-to-use `PodmanIsolationLoader` is included. Its generated default plan uses:

- `--network=none`
- read-only container rootfs
- `--cap-drop=ALL`
- `no-new-privileges`
- PID, memory, and CPU limits
- read-only plugin/runtime mounts
- small `noexec,nosuid,nodev` tmpfs
- Node permission mode inside the container
- the existing restrictive ESM loader
- host-side capability-grant enforcement

This requires a local Podman installation and an appropriate Node image. Podman execution is not claimed as qualified in the packaged test environment; command-plan generation and controls are tested.

### Durable audit journal

`DurableAuditJournal` extends the in-memory hash-chain ledger with append-only JSONL persistence.

- SHA-256 chain verification on recovery
- optional HMAC verification
- recursive redaction before hashing/persistence
- fsync-on-append by default
- optional recovery of a final partial record
- fail-closed startup on tampering or malformed records
- standalone `verifyDurableAuditJournal(...)` helper

### Retry-safe action receipts

`registerActionReceiptPlugin(...)` adds cross-dispatch **exactly-once-or-detect** semantics to selected side-effect events.

Lifecycle:

```text
new action ID
    |
    v
persist STARTED + fsync
    |
    v
run lower hook/base action
    |
    +---- success ----> persist COMPLETED + result
    |
    +---- error ------> persist INDETERMINATE
```

A completed action ID returns the stored result without re-executing the lower chain. A started/indeterminate action fails closed on retry because the runtime cannot prove whether the external side effect happened before the failure.

Both in-memory and append-only file receipt stores are included.

### Semantic event schema registry

Core event definitions are tagged `1.0.0`, and `EventSchemaRegistry` adds:

- semantic version registration
- highest-common-version negotiation
- input/result validation per version
- explicit migration edges
- migration-path discovery
- validation after every migration step

The base runtime does not silently migrate events. Version conversion must be explicitly registered and invoked.

### Deterministic replay support

`ReplayLog` and `registerReplayRecorder(...)` can capture:

- event name
- host-bound origin
- immutable input
- result/error
- config hash
- plugin-set hash
- generation ID
- deterministic record hash

`replayAndVerify(...)` re-dispatches a recorded successful call and compares canonical results. This is intended for pure/mock adapters and policy-regression qualification, not irreversible live side effects.

### Transactional runtime generations

`RuntimeGenerationManager` implements atomic generation publication and drain semantics:

1. build candidate runtime;
2. start it independently;
3. run named health checks;
4. atomically publish the candidate generation;
5. mark the old generation draining;
6. allow existing leases to finish on the old generation;
7. close the old generation after the final lease releases;
8. optionally persist an activation receipt.

This gives plugin/runtime update machinery a clean generation boundary instead of mutating live hook stacks in place.

## Retained v0.2 controls

- immutable event values and frozen dispatch metadata;
- before / after / during / instead / modifying behavior from one continuation primitive;
- substructural matchers and wildcard hooks;
- self-recursion suppression while preserving observation by other hooks;
- `engine.create` fold for constructing `$`;
- additive engine ownership: add or withhold, never silently replace;
- deterministic prepend / dependency / append ordering;
- input/result schemas and runtime size/deadline budgets;
- automatic one-call `next()` ceiling for non-idempotent side effects;
- Ed25519-sealed managed configuration;
- exact plugin package digest pinning before code execution;
- symlink escape detection;
- hash-chain/HMAC audit and recursive redaction;
- origin allowlists and engine blast-door controls;
- process-isolated hooks with restrictive imports and host-mediated `$` RPC;
- bounded process memory/protocol frames and kill-on-timeout;
- isolated `engine.create` denial.

## Architecture

```text
                       signed managed configuration
                                 |
                                 v
                     deterministic plugin order
                     earlier = greater authority
                                 |
                                 v
+----------------+      +-------------------------+      +------------------+
| plugin isolate | RPC  | FunctionHooksRuntime    |      | trusted adapters |
| Node / Podman  |<---->| policy + hook algebra   |<---->| fs/net/model/... |
| grants applied |      | schemas + budgets       |      +------------------+
+----------------+      +------------+------------+
                                    |
                          $.noun.event(input)
                                    |
             +----------------------+----------------------+
             |                      |                      |
             v                      v                      v
       durable audit          action receipts        replay records
             |                      |                      |
             +----------------------+----------------------+
                                    |
                                    v
                         runtime generation manager
```

## Quick start

```bash
npm install
npm test
npm run demo
npm run demo:isolated
npm run qualify
```

## Isolation examples

Local permission-process profile:

```ts
const loader = new NodePermissionProcessLoader(runtime, {
  capabilityGrants: { events: ["ui.log"] },
  maxOldSpaceMb: 96,
})
```

Rootless Podman profile:

```ts
const loader = new PodmanIsolationLoader(runtime, {
  podman: {
    image: "node:22-alpine",
    memoryMb: 192,
    cpus: 1,
    pidsLimit: 64,
  },
  process: {
    capabilityGrants: { events: ["ui.log"] },
  },
})
```

The second form uses the same hook RPC worker, but launches it behind a stronger OS/container boundary.

## Qualification boundary

The packaged build proves local TypeScript compilation and the behaviors exercised by its executable tests. It does **not** establish:

- compatibility with an Anthropic production implementation;
- Firecracker/gVisor/Kata equivalence;
- Podman runtime availability or kernel policy correctness on every host;
- resistance to Node/container/kernel vulnerabilities;
- distributed consensus or multi-host exactly-once semantics;
- full JSX/surface reconciliation;
- live hot-upgrade compatibility across arbitrary plugin schema changes.

The action-receipt layer intentionally claims **exactly-once-or-detect**, not magical exactly-once delivery. If an external action may have executed and the completion receipt was not durably committed, retry is blocked as indeterminate.

## Repository layout

- `packages/core/` — stable-candidate hook algebra and executable conformance contract.
- `packages/core/` — stable-candidate hook algebra plus frozen executable conformance contract.
- `packages/portable/` — independent explicit-frame implementation with a Node-free source/TypeScript portability gate.
- `packages/events/` — optional standard event catalog and bootstrap.
- `packages/assurance/`, `audit/`, `replay/`, `plugins/`, `isolation/`, `enterprise/` — independently versioned higher layers.
- `packages/compat/` — deprecated wildcard/schema/`engine.create` runtime, reachable only through explicit compatibility imports.
- `api-snapshots/` — normalized public declaration fingerprints.
- `contracts/` — frozen semantic-contract fingerprint.
- `src/plugin/isolation/` — RPC protocol, capability grants, process loader, restrictive ESM loader, Podman launcher.
- `src/replay/` — replay recording and canonical result verification.
- `src/enterprise/` — audit, blast door, origin allowlist, managed controls.
- `src/ui/` — surface vocabulary corresponding to the paper's render model.
- `tests/` — semantic, security, durability, lifecycle, replay, manifest, order, and isolation tests.
- `docs/` — analysis, threat model, isolation notes, traceability, qualification, roadmap.

## License and attribution

MIT licensed independent reference implementation. The architecture is based on concepts described in the cited Anthropic paper; all code and hardening extensions in this repository are independent.
