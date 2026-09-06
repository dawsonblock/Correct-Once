# Architecture Traceability — v0.3.0

> Historical baseline: this document describes the v0.3-era design. The current distribution is v0.11.0; current gateway/release evidence is in `AGENT_GATEWAY.md`, `QUALIFICATION.md`, and `BUILD_REPORT.md`.


This document separates **source-derived semantics** from **independent hardening extensions**.

## Source-derived semantics

| Paper concept | Reference implementation |
| --- | --- |
| hooks module registers callbacks through `on` | `src/plugin/loader.ts`, `FunctionHooksRuntime.registrar` |
| hook signature `($, e, next)` | `src/runtime/types.ts`, `src/runtime/runtime.ts` |
| registration order is nesting | runtime selected-hook fold + order tests |
| before / after / during / instead / modifying placements | ordinary continuation behavior, runtime tests |
| immutable event values | `src/runtime/freeze.ts` |
| dispatch-local `next.signal`, `next.event`, `next.origin`, `next.is` | `src/runtime/runtime.ts` |
| substructural matcher | `src/runtime/matcher.ts` |
| wildcard `*` event | runtime event selection |
| recursive self-hook suppression | AsyncLocalStorage skip-set in runtime |
| `$` consists of hookable `noun.event` methods | engine materialization in runtime |
| `engine.create` fold builds `$` | `src/runtime/blueprint.ts`, runtime startup |
| plugins add/withhold rather than replace existing event definitions | blueprint transition validation |
| managed prepended/appended ordering | `src/runtime/order.ts`, plugin manager |
| render/surface vocabulary | `src/ui/surfaces.ts` (partial reference implementation) |

## Independent v0.2 hardening extensions

- typed runtime value schemas;
- input/result/deadline/multiplicity budgets;
- non-idempotent side-effect continuation cap;
- sealed managed configuration;
- package digest pinning;
- realpath/symlink admission checks;
- hash-chain/HMAC audit and redaction;
- isolated-process hook RPC;
- restrictive ESM plugin imports;
- host-bound isolated origin;
- process memory/frame/time limits;
- isolated `engine.create` denial.

## Independent v0.3 hardening extensions

- deny-by-default per-plugin `$` grants;
- grant visibility in child proxy plus host-side re-enforcement;
- generic isolation launch builder;
- rootless Podman sandbox loader/plan;
- durable fsync-capable audit journal and crash-recovery verification;
- persistent action receipt journal with exactly-once-or-detect semantics;
- semantic event schema versions and explicit migration graph;
- deterministic replay records and canonical replay verification;
- runtime generation health gate, atomic publication, lease draining, and activation receipts.

These extensions are engineering interpretations of what would be required to operate the source algebra as a security-sensitive agent/runtime substrate. They are not attributed to the paper unless explicitly present in the source text.
