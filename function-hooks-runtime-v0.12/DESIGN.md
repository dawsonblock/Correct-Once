# Function Hooks Runtime 0.12 scaffold / v0.13 correctness track

This package starts a **parallel 0.12 track** without changing the frozen
`mcp-hooks` v0.1.1 behavior on `main`. The existing adapter tree, smoke path,
and Makefile targets remain the same. The current scope is a **v0.13
correctness release only**: close admit-time class drift, auth, idempotency,
and effect-client boundary bugs without relaxing the sealed adapter,
`effect-fabric`, or `function-hooks-core-reference` freezes.

## Where `executionClass` is admitted

`src/admission.ts` wraps the existing B admission flow:

1. `createCapabilityCandidate(...)` stays in `@function-hooks/capabilities`.
2. `admitRuntimeCapability(...)` calls B's `admitCapability(...)`.
3. The 0.12 wrapper attaches an admit-time execution policy:
   - `pure`
   - `read`
   - `mutation`
   - `critical`
4. Admission also pins:
   - executor id
   - `schemaHash`
   - schema/class digest

That policy is stored beside the admitted capability in the 0.12 runtime
registry, instead of retrofitting the frozen 0.11.0 package APIs.

## Admit-time compatibility matrix

Admission now checks **implementation semantics**, not just `sideEffect`:

| executionClass | Allowed implementation kinds | Notes |
| --- | --- | --- |
| `pure` | `filesystem.read`, HTTP `GET`/`HEAD`/`OPTIONS`, MCP only when `implementation.descriptor.authenticated=true` and `implementation.descriptor.readOnly=true` | `pure` still must pin `pureHandlerId`; no external fallback |
| `read` | `filesystem.read`, HTTP `GET`/`HEAD`/`OPTIONS`, MCP only when `implementation.descriptor.authenticated=true` and `implementation.descriptor.readOnly=true` | mutating implementations fail closed at admit time |
| `mutation` | `filesystem.write`, mutating HTTP methods, `process`, `browser`, `desktop`, `mcp` | executes through guarded direct Function Hooks dispatch |
| `critical` | `mcp` only | reserved for the governed Effect Gateway client path in v0.13 |

Implications:

- `filesystem.write`, mutating HTTP, `process`, `browser`, and `desktop`
  **cannot** admit as `pure` or `read`.
- Non-MCP `critical` capabilities fail closed in this scaffold.
- The `implementation.descriptor.{authenticated,readOnly}` object is a
  **minimal bridge** for MCP read semantics because the frozen 0.11.0 capability
  types do not yet model authenticated MCP descriptor evidence directly.

## Handle cache and compiled execution

`src/runtime.ts` compiles a `CompiledCapabilityHandle` the first time an id is
resolved. The handle intentionally keeps a future numeric-index shape:

- `id`
- `executor`
- `executionClass`
- `risk`
- `schemaHash`
- `policyHookId`

The handle also keeps the already-compiled route or executor metadata needed to
invoke without repeating search -> metadata -> route compilation on every call.
Runtime invocation rechecks the cached handle pin before execution:

- `executionClass`
- executor id
- `schemaHash`
- schema/class digest
- pinned hook ids
- `requiresLightweightAuth`
- `trustedRead`

`src/handle-cache.ts` caches those handles by capability id. The in-memory 0.12
registry exposes `subscribe(...)`, so the runtime can invalidate a cached handle
when that capability record changes.

## Dispatch tiers

- `FastExecutor`
  - Handles `pure`
  - Handles `read`
  - `pure` executes only through a pinned in-process handler id
  - `read` executes through direct Function Hooks dispatch
  - `read` still runs lightweight subject + allowlist policy hooks on every call

- `GuardedExecutor`
  - First-tier executor for `mutation`
  - Executes ordinary writes through direct Function Hooks routing
  - Requires idempotency keys
  - Requires receipt hooks
  - Rechecks lightweight policy/auth on every call
  - Uses subject-scoped idempotency keyed by
    `subject + capability id + idempotencyKey + canonical action digest`
  - Same key + different digest is `IDEMPOTENCY_CONFLICT`
  - If receipt persistence fails after an external attempt, the cached entry is
    retained and the call fails `NEEDS_RECONCILIATION` instead of re-executing

- `EffectExecutor`
  - Handles `critical` directly
  - Accepts only a branded Effect Gateway client created by
    `createEffectGatewayClient(...)`
  - Preserves fail-closed checks on the effect path:
    - object args only
    - subject authority required
    - `provenance.schemaDigest === schemaHash`
    - destructive default stays OFF unless explicitly enabled

## Auth invariant

Pure/read capabilities do **not** go through Effect Fabric in this scaffold,
but they also do **not** get a silent auth bypass.

`read` defaults to `requiresLightweightAuth: true` unless admission explicitly
opts out. `private`, `secret`, and `unknown` sensitivity can **never** opt out
of lightweight auth. When lightweight auth is required, a `policyHookId` must
be present at admission time or admission fails closed. Cached handles do not
cache auth; the policy hook runs every invoke.

Guarded writes also require a non-empty subject even when lightweight auth is
disabled for a public capability, because the subject is part of the idempotency
namespace and prevents cross-tenant aliasing.

`pure` is stricter: it must pin an in-process `pureHandlerId` at admission time
and never compiles an external route. There is no MCP/network/FS fallback.

## Effect Gateway bridge

`src/effect-gateway-bridge.ts` now owns its own minimal bridge logic instead of
dynamically importing `../../adapter/ts/*.ts` at runtime. The runtime accepts a
branded/opaque Effect Gateway client created by `createEffectGatewayClient(...)`
and refuses a bare function shape.

## Curated host surface

This scaffold keeps the host-facing model aligned with the frozen adapter:

- search admitted capabilities
- invoke capability by id

It does **not** add OpenAPI generation, one-tool-per-endpoint exports, or raw
MCP host bypass APIs.

## Explicitly unfinished

- No persistent handle cache yet; current cache is in-memory only.
- No numeric indexing yet; the handle shape is chosen so that can come later.
- `GuardedExecutor` idempotency is still in-memory, not durable across process
  restart.
- In-flight revocation versus already-resolved cached handle execution remains a
  race; v0.13 only rechecks the cached pin/auth surface on invoke.
- MCP semantic discovery is still intentionally thin. Beyond the temporary
  `implementation.descriptor.authenticated/readOnly` bridge, richer MCP
  classification can wait.
- Effect-tier execution is currently limited to admitted MCP-backed
  capabilities; non-MCP `critical` capabilities fail closed until a governed
  backend exists.
- The MCP server entrypoint story beyond the current host gateway composition
  can wait; v0.13 only fixes the runtime-side bridge and approved client shape.
- Read allowlists are implemented through pinned policy hooks today; a richer
  declarative allowlist format can be layered on later without changing the
  admit-time pinning contract.
