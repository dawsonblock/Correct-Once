# Function Hooks Runtime 0.12 scaffold

This package starts a **parallel 0.12 track** without changing the frozen
`mcp-hooks` v0.1.1 behavior on `main`. The existing adapter tree, smoke path,
and Makefile targets remain the same.

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
  - Requires idempotency keys
  - Requires receipt hooks
  - Adds scaffold hooks for lightweight policy, idempotency, and receipts
  - Delegates actual mutation execution to `EffectExecutor`

- `EffectExecutor`
  - Handles `critical` directly
  - Executes the guarded mutation inner step
  - Reuses the locked Effect Gateway transport helper from `adapter/ts`
  - Preserves fail-closed checks on the effect path:
    - object args only
    - subject authority required
    - `provenance.schemaDigest === schemaHash`
    - destructive default stays OFF unless explicitly enabled

## Auth invariant

Pure/read capabilities do **not** go through Effect Fabric in this scaffold,
but they also do **not** get a silent auth bypass.

`read` defaults to `requiresLightweightAuth: true` unless admission explicitly
opts out. When lightweight auth is required, a `policyHookId` must be present at
admission time or admission fails closed. Public reads can opt out deliberately;
private reads must stay explicit. Cached handles do not cache auth; the read
policy hook runs every invoke.

`pure` is stricter: it must pin an in-process `pureHandlerId` at admission time
and never compiles an external route. There is no MCP/network/FS fallback.

## Curated host surface

This scaffold keeps the host-facing model aligned with the frozen adapter:

- search admitted capabilities
- invoke capability by id

It does **not** add OpenAPI generation, one-tool-per-endpoint exports, or raw
MCP host bypass APIs.

## Explicitly unfinished

- No persistent handle cache yet; current cache is in-memory only.
- No numeric indexing yet; the handle shape is chosen so that can come later.
- `GuardedExecutor` idempotency is an in-memory scaffold, not a durable store.
- Effect-tier execution is currently limited to admitted MCP-backed capabilities;
  non-MCP high-tier capabilities fail closed until a separate design exists.
- Read allowlists are implemented through pinned policy hooks today; a richer
  declarative allowlist format can be layered on later without changing the
  admit-time pinning contract.
