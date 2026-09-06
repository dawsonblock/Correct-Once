> Historical freeze note: this file documents the v0.1.1 adapter + B freeze. Current in-tree Effect Fabric is `0.2.12`; see `README.md` and `effect-fabric-v0.2.12/`. The `0.2.11` pin below is historical only and does **not** claim a new packaging release or `RELEASE_QUALIFIED`.

# MCP Hooks Upgraded Bundle v0.1.1

Historical freeze pins:
- effect-fabric **0.2.11** (A)
- function-hooks-core-reference **0.11.0** (B)
- adapter **0.1.1**

## Critical path (mandatory)
```ts
const { mcpCall } = composeEffectLockedMcpOptions(effectGateway);
const adapters = await createNodeGatewayAdapters({ /* roots */, mcpCall });
await createEffectLockedAgentGateway(createAgentGateway, { /* opts */, adapters });
```
Do not call bare `createAgentGateway` with an unlocked `mcp.call`.

## Freeze
- No OpenAPI path
- Tools: `search_capabilities` + `invoke_capability` only
- Destructive default OFF
- Smoke is mirrored gates only (not live effect_fabric)

## Verify
```bash
python3 adapter/fixtures/run_smoke.py
```
