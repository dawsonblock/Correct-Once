# MCP Hooks Upgraded Bundle v0.1.1

Pins:
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
