# Deep Architectural Analysis — v0.3.0

> Historical baseline: this document describes the v0.3-era design. The current distribution is v0.11.0; current gateway/release evidence is in `AGENT_GATEWAY.md`, `QUALIFICATION.md`, and `BUILD_REPORT.md`.


## Executive assessment

The Function Hooks proposal is best understood as a **capability-oriented middleware kernel**, not merely a plugin callback mechanism. Its core move is to collapse the host's callable authority and observable events into the same interface: every method on `$` is an event, and every event is subject to ordered continuation composition. That gives policy, auditing, mutation, replacement, rendering, and extension one algebra instead of a family of unrelated interception APIs.

The proposal is structurally elegant, but elegance creates a sharp security obligation: if plugin code can bypass `$`, the architecture loses its strongest audit and policy claim. v0.3.0 is therefore organized around making the `$` boundary operationally meaningful while preserving the source model rather than replacing it with a conventional permission framework.

The result is materially stronger than v0.2.0. It now has deny-by-default per-plugin grants, a container-backed launch path, durable tamper-evident evidence, retry-safe action receipts, explicit schema evolution, deterministic replay, and generation-based update semantics. These are independent hardening extensions; they are not claims about the source proposal itself.

## 1. The algebra is the architecture

The source defines hooks as Koa-style middleware: `($, e, next) => R | Promise<R>`. Registration order becomes nesting. If A is registered before B, A wraps B and observes both the request before B and the result after B. A may also modify the event, suppress lower execution, or invoke lower execution more than once.

That has two consequences.

First, a separate “pre-hook” and “post-hook” API is unnecessary. Before, after, during, instead, and modifying placements all fall out of ordinary continuation control flow.

Second, **order is authority**. An earlier plugin has strictly more structural leverage than a later plugin because it wraps more of the stack. Managed ordering cannot be treated as cosmetic configuration; it belongs in the trusted computing base.

The runtime preserves this property exactly. Hooks are sorted by plugin order and local registration order, and the selected stack is folded around the base event implementation.

## 2. `$` is an object-capability boundary only if ambient authority is removed

The source's strongest security-oriented statement is that `$` is everything a hook can see or do and that plugin code should not have ambient filesystem/network authority. If true, every privileged action becomes observable and governable because it crosses `$.noun.event(...)`.

A runtime that exposes `$` but also lets plugins import `node:fs`, invoke `fetch`, spawn a shell, or read process credentials has only partial mediation. Policy hooks can be bypassed and audit records become incomplete.

v0.3.0 uses two complementary controls:

1. **isolation** removes or constrains ambient channels;
2. **capability grants** determine which `$` calls a plugin is actually allowed to make.

The local Node profile is a reference hardening boundary. The stronger Podman profile adds an OS/container boundary while preserving the same host-mediated RPC contract.

## 3. Capability grants close a v0.2 design gap

v0.2.0 isolated plugin code but gave it a dynamically discoverable `$` proxy and depended primarily on host policy to deny inappropriate calls. That was secure only if the host policy was complete, and it provided a larger apparent capability surface than necessary.

v0.3.0 changes the default to **no engine capabilities**. A plugin may receive exact events (`ui.log`), a noun wildcard (`fs.*`), or the global wildcard (`*`). The child proxy omits denied nouns/events, and the host checks the same grant again before dispatching an engine RPC.

This is defense in depth rather than trust in client behavior. A malicious child can construct raw RPC protocol messages, but it still cannot exceed the host-side grant set.

The continuation `next` remains separately available because it is not ambient engine authority; it is the current dispatch continuation explicitly handed to the hook by the host.

## 4. The Podman path strengthens containment without changing semantics

A useful isolation design should not force plugin semantics to depend on the sandbox technology. v0.3.0 therefore keeps a stable process/RPC contract and makes process launch pluggable.

`PodmanIsolationLoader` launches the same worker using a rootless container plan with no network, read-only rootfs, no Linux capabilities, no-new-privileges, bounded PID/memory/CPU resources, read-only plugin/runtime mounts, and a restricted tmpfs. Node's permission mode and restrictive ESM loader remain active inside the container.

This layering matters. Container policy is not relied upon to understand hook semantics, origin identity, event schemas, continuation multiplicity, or capability grants. Those remain host responsibilities. The sandbox limits what happens if plugin code or the language runtime is compromised.

The packaged qualification tests the generated plan, not actual Podman execution. Host kernel policy and container runtime behavior remain an environmental qualification gate.

## 5. Continuation multiplicity and side-effect safety

The source intentionally permits a hook to call `next` zero, one, or many times. This is expressive: retries, speculative execution, comparison, and fan-out can all be written naturally.

For a non-idempotent event, however, multiple continuation calls can duplicate irreversible actions. v0.2.0 addressed same-dispatch duplication by deriving a one-call continuation budget for side-effecting non-idempotent events.

v0.3.0 extends the protection across dispatches with **action receipts**.

The runtime persists `STARTED` before invoking the lower action. On success it persists `COMPLETED` plus the result. A retry of a completed action returns the recorded result without executing again. If execution fails after `STARTED`, the receipt becomes `INDETERMINATE`; automatic retry is refused.

This is deliberately called exactly-once-or-detect rather than exactly-once. No middleware can prove an external side effect did not happen if the remote system acted and the local process failed before recording completion. Failing closed is the correct behavior unless the external system supports an authoritative idempotency key or reconciliation query.

## 6. Durable audit evidence is more than an in-memory hash chain

The source shows that a prepended wildcard hook can observe every event. v0.2.0 implemented a hash-chained audit ledger with optional HMAC and recursive redaction, but the ledger was memory-resident.

v0.3.0 adds an append-only durable journal. Startup parses the journal, verifies the chain and optional HMAC, and refuses tampered data. Appends use fsync by default. A final partial record can be rejected or explicitly repaired during crash recovery.

This does not make the journal an external trust anchor. A privileged host administrator with both journal and HMAC key can still rewrite history. The next assurance step is external key custody and signed/anchored journal epochs.

## 7. Engine shape remains bootstrap authority

The source's `engine.create` fold is unusually powerful. Plugins can add nouns/events to `$`, and higher layers can withhold capabilities. Existing event definitions may not be silently replaced; behavior changes happen through ordinary hooks.

That makes engine-shape authority stronger than ordinary event-hook authority. v0.3.0 continues to prohibit isolated untrusted plugins from registering `engine.create`. Shape mutation remains bootstrap-trusted.

The distinction is important because a plugin allowed to invent privileged engine methods could create a bypass around ordinary enterprise controls if those methods were not included in policy assumptions.

## 8. Schema evolution is explicit instead of implicit

Runtime schemas protect individual dispatches, but production plugin ecosystems also need a compatibility story across versions.

v0.3.0 adds semantic schema versions and an explicit registry. Supported versions can be negotiated, and migrations are directed edges with validation after each step. No automatic coercion occurs inside ordinary dispatch.

This preserves the functional character of the architecture: a migration is an explicit value transformation with an auditable source and destination version rather than hidden host behavior.

Core events are tagged `1.0.0` in this reference build.

## 9. Replay supports policy regression, not irreversible live execution

A continuation architecture is difficult to debug if only final outputs are retained. Replay records therefore capture the event, immutable input, bound origin, result/error, and caller-supplied configuration/plugin/generation hashes.

The replay verifier re-dispatches a successful event and compares canonical results. This is valuable for pure adapters, mocks, evaluation harnesses, and policy regressions.

It must not be treated as a generic production replay button. Re-dispatching a live `payment.send`, `fs.write`, or physical-device action can create new effects. The action-receipt layer or a mock adapter must mediate such cases.

## 10. Runtime generations solve the unsafe hot-mutation problem

Directly mutating a live hook stack creates ambiguous semantics: requests may observe half-applied changes, old isolates may still be running, and rollback boundaries are unclear.

v0.3.0 introduces generation publication. A candidate runtime is constructed independently, started, health-checked, and then published in one host-level assignment. New leases use the new generation. Existing leases continue on the old generation until release, after which the old generation can be closed.

This is a clean primitive for transactional plugin upgrades. It does not yet stage packages or resolve schema compatibility automatically; those are the next lifecycle layers.

## 11. Current security posture

The build can credibly claim the following within its tested scope:

- deterministic continuation semantics;
- immutable event rewriting with schema checks;
- controlled continuation multiplicity;
- sealed configuration and package pinning;
- isolated plugin execution with restrictive imports;
- deny-by-default per-plugin engine grants;
- host-bound plugin origin;
- durable tamper-detecting local audit evidence;
- retry-safe exactly-once-or-detect side-effect receipts;
- semantic schema negotiation/migration primitives;
- deterministic replay under pure/mock adapters;
- health-gated atomic runtime generation publication and draining;
- a concrete rootless Podman launch path using the same RPC authority plane.

It cannot credibly claim:

- formal sandbox security;
- microVM-equivalent isolation in the default Node profile;
- live qualification of Podman on every target host;
- external immutability of audit evidence;
- distributed exactly-once semantics;
- automatic safe recovery of indeterminate external effects;
- full implementation of the paper's cross-surface JSX/render reconciliation model.

## 12. Strategic interpretation

The architecture becomes most valuable when treated as a **small authority kernel** beneath a larger agent platform. Browser automation, shell tools, MCP adapters, Home Assistant, model calls, secrets, UI prompts, and remote workers can all be represented as events mediated by the same policy/order/audit machinery.

The wrong next move would be to add a large convenience framework on top before qualifying the boundary. The correct next move is operational: run hostile-code qualification against Podman/gVisor/Firecracker-class providers, externalize key custody, complete package staging/rollback transactions, and add operator resolution for indeterminate action receipts.
