# Curated MCP catalog adapter — B admission → A effect gateway

Freeze contract for mapping **function-hooks-core-reference v0.11.0** (archive B)
admitted capabilities onto **effect-fabric v0.2.11** (archive A) Effect Gateway.

## Decision lock (do not reopen)

- No OpenAPI / FastMCP `from_openapi` for these archives.
- **B** is the curated catalog / admission source of truth.
- **A** is the runtime bridge: discovery → auth; schema-digest deny on drift.
- Emit MCP tools **only** as `search_capabilities` + `invoke_capability(id, args) `.
- Tag each capability `read | write | destructive` (derived from B `sideEffect`).
- Security gates at **CALL TIME**: re-check identity + allowlist class + scope;
  reload the authoritative registry snapshot on every invoke; fail closed on
  unknown ops; never mint from floating `latest`; no tokens in schemas/receipts;
  destructive requires explicit allow flag default **OFF**.

## Freeze versions

| Side | Artifact | Version |
|------|---------|--------|
| A | effect-fabric | `0.2.11` |
| B | function-hooks-core-reference / `@function-hooks/capabilities` | `0.11.0` |
| Adapter DTO | `function-hooks.capability-registry.v1` → adapter snapshot | `adapter/admitted-registry/v1` |

## Flow

```text
B createCapabilityCandidate → admitCapability → InMemoryCapabilityRegistry.register
        |
        v (export active admitted records only)
adapter/admitted-registry/v1 JSON  (no tokens, no floating latest)
        |
        v
A EffectDefinitionFactory + EffectGateway.register_tool  (schema pin = B inputSchema)
        |
        v
curated MCP surface: search_capabilities / invoke_capability
        |
        v
A GatewayPolicy.authorize + adapter call-time re-check → EffectGateway.call_tool
```

For mutating calls, `invoke_capability(...)` derives a trusted idempotency
namespace from `subject + capability id + caller idempotency key`, derives a
stable action id from that tuple plus the canonical input digest, and passes
both into Effect Gateway / Effect Fabric. Same-key different-payload reuse now
conflicts, while different subjects stay isolated.

## What this scaffold is / is not

**Is:** minimal, fail-closed wiring verified against archive source symbols.
**Is not:** a full package install, live MCP server, or production policy engine.

## Run posture

Prefer reading sources under the extracted trees. Do not `npm install` / `pip install`
both archives unless type-checking requires it. Point `PYTHONPATH` at A's
`source/effect-fabric-0.2.11/src` when importing `effect_fabric.*`.

## Key symbols (verified)

### B (`packages/capabilities`, `packages/router`)

- `createCapabilityCandidate`, `admitCapability`, `assertAdmittedCapability`
- `InMemoryCapabilityRegistry.register|list|get`
- `projectAgentCapabilityCatalog`
- `CapabilitySideEffect` = `read|write|external|destructive|unknown`
- `compileAdmittedCapabilityRoute`, `createExecutionRouterFromRegistry`

### A (`src/effect_fabric`)

- `EffectGateway.register_tool`, `EffectGateway.call_tool`, `EffectGateway.list_tools`
- `EffectDefinitionFactory`, `EffectRegistryV3.route` / `bind`
- `MtpToolIdentity.schema_digest` via `digest_document`
- `MutationClass` = `read_only|mutating|destructive|unknown`
- `GatewayPolicy.authorize` / `DenyAllMutationPolicy` / `StaticGatewayPolicy`
- `MtpMutationExecutor` re-checks schema digest immediately before I/O

See `MAPPING.md` for the field-level table.


## Host composition lock

```ts
import { createNodeGatewayAdapters } from "@function-hooks/gateway";
import {
  composeEffectLockedMcpOptions,
  assertMcpCallIsEffectLocked,
  assertNoManualMcpRoutes,
} from "./ts/composeLockedAdapters.js";

assertNoManualMcpRoutes(manualRoutes); // must be empty of MCP
const { mcpCall } = composeEffectLockedMcpOptions(effectGatewayCallTool);
const adapters = await createNodeGatewayAdapters({ /* roots... */, mcpCall });
await createEffectLockedAgentGateway(createAgentGateway, { ...opts, adapters });
```

Smoke the four Security Expert fixtures:

```bash
python3 fixtures/run_smoke.py
```
