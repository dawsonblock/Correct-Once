# Security Expert / CR gate status — adapter 0.1.1

## Scaffold gates
1. Register requires `provenance.schemaDigest == schemaHash`; A pin via `McpToolIdentity(input_schema=…)`.
2. `ts/effectGatewayMcpCall.ts` — no raw MCP SDK; `assertNoManualMcpRoutes` refuses MCP manual routes.
3. Call-time policy keys on `(server, tool)`; clean args; `allow_destructive` default OFF.

## Composition lock (0.1.1)
- Brand is a **module-private** `Symbol(...)` (not `Symbol.for`, not exported) — cannot be forged by name from outside this module.
- Critical path helper: `createEffectLockedAgentGateway(createAgentGateway, options)` **always** runs `assertMcpCallIsEffectLocked` before creating the gateway. Hosts must use this instead of bare `createAgentGateway`.
- `composeEffectLockedMcpOptions` → `createNodeGatewayAdapters({ mcpCall })` → `createEffectLockedAgentGateway(...)`.

## Smoke honesty
- `fixtures/run_smoke.py` is an explicit **mirror** of the gates. It does **not** import `effect_fabric` and does **not** prove live A integration.

## Packaging
- Archives must not include `__pycache__` or `*.pyc`.
