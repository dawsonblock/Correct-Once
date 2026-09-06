# Native Transition Kernel — v0.2.8

v0.2.6 removed the locked donor `reduce()` function from the newest direct durable-agent-outbox
compatibility path. v0.2.8 preserves that boundary and hardens hostile/late command handling plus the
release evidence that claims the boundary was qualified.

The checked-in reducer is:

`bridges/durable-agent-outbox/effect_fabric_native_reduce.ts`

The qualifier compiles the exact locked donor core/conformance sources, compiles the Effect Fabric
native kernel beside them, redirects the scheduler import, and poisons the compiled donor `reduce()`
function. The official upstream scenario suite must therefore succeed without donor transition
fallback.

Qualified boundary when the donor gate is actually executed:

```text
Official ConformanceHarness
        ↓
EffectFabricNativeScheduler
        ↓
Effect Fabric native transition kernel
        ↓
Effect Fabric pre-commit invariant gate
        ↓
Effect Fabric SQLite CAS store
        ↓
Effect Fabric post-operation invariant shadow
```

v0.2.8 retains the v0.2.7 hardening and additionally enforces canonical crosswalk discipline:

- `ATTEMPT_RESULT` must match both current lease epoch and active worker ownership;
- ACK must match the action's current lease epoch and carry a non-empty worker identity;
- a second withdrawal recorded while an action remains uncertain cannot present an older/equal
  revocation epoch.

These checks harden the reducer against malformed or stale shell messages. They do not turn the
compatibility reducer into an authenticated transport boundary; callers still need authenticated
worker identity and trustworthy command ingestion.

The native kernel is an MIT-derived compatibility implementation. See
`THIRD_PARTY_NOTICES.md` and `LICENSES/durable-agent-outbox-MIT.txt`.

The native compatibility kernel is **not** the production `EffectEngine` transaction model.
Production promotion still requires a deliberate mapping of DAO states into Effect Fabric's
capability/fencing/evidence lifecycle and live PostgreSQL/process-failure qualification.


## Canonical-algebra relationship in v0.2.8

The donor reducer remains a compatibility kernel with richer request/lease/withdrawal states. It is not forced into the production `ExecutionState` enum. Instead, `effect_fabric.dao_crosswalk` provides an explicit semantic crosswalk, while the production engine, stores, and Python reducer share the canonical legal-edge table generated from `spec/effect-transition-v1.json`. Unknown donor statuses fail closed.
