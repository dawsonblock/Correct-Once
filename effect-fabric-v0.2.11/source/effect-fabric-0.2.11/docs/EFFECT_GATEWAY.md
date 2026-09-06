# Effect Gateway — v0.2.10

Effect Gateway is the integration boundary between an agent/planner and consequential external tools.
The agent should call the gateway, not the mutating MCP transport directly.

```text
Agent / NARE
    |
    v
EffectGateway
    |-- EffectRegistryV3: tool identity + pinned schema + dynamic effect factories
    |-- GatewayPolicy: independent allow/deny/approval boundary
    |-- EffectEngine: capability + durable STARTED + fencing + UNKNOWN/reconciliation
    |
    +--> McpTransport --> MCP server
```

## Registration model

Each MCP tool is explicitly registered. A mutating registration provides factories that derive the
exact resource, contract, idempotency key, and reversibility metadata from the call arguments. This
avoids the v0.2.9 limitation where a static registry definition could describe a tool but not safely
bind per-call authority such as `issue=42` versus `issue=43`.

The registration includes a pinned `McpToolIdentity` input-schema digest. The gateway checks the
live tool schema during routing and the MCP mutation executor checks it again immediately before the
external call. A changed schema is a definitive pre-effect rejection.

## Read-only behavior

Registered read-only tools bypass EffectEngine and call the transport directly. Unknown tools are
denied by default even when the MCP server advertises a read-only hint. `allow_unregistered_reads`
exists only as an explicit compatibility mode.

## Mutation lifecycle

For a registered mutation:

1. Fetch current MCP tool metadata and validate the pinned schema.
2. Bind arguments into an exact effect definition.
3. `EffectEngine.propose()` persists the action digest.
4. `prepare()` captures any configured pre-state/probe.
5. `GatewayPolicy.authorize()` makes the independent policy decision.
6. Effect Fabric mints a narrowly bound capability.
7. EffectEngine durably commits STARTED and fencing ownership.
8. The MCP executor revalidates the schema and calls the MCP transport.
9. Ambiguous/unclassified failures become `UNKNOWN`.
10. A configured reconciliation probe may settle `UNKNOWN`; otherwise it remains unknown.
11. A registered verifier may run automatically after a known terminal execution outcome.

The gateway never treats a policy denial or missing approval as permission to call the transport.

## Policy

The default `DenyAllMutationPolicy` rejects every mutation. `StaticGatewayPolicy` is included for
local deployments/tests and supports explicit operation allow-lists plus approval-required
operations protected by a secret verifier. Production systems should replace it with an external
policy/approval authority.

Raw approval tokens are not persisted. The policy returns an approval digest that is bound into the
Effect Fabric authorization record.

## MCP SDK integration

Effect Fabric still does not depend on a specific MCP SDK. Implement three methods:

```python
async def describe_tool(server, tool) -> McpToolDescriptor: ...
async def list_tools(server) -> list[McpToolDescriptor]: ...
async def call_tool(server, tool, arguments) -> McpToolResult: ...
```

Then pass that object as `transport=` to `EffectGateway`.

`create_gateway_app()` provides an optional authenticated HTTP wrapper at
`POST /gateway/tool-call`. It is a service wrapper around the same gateway object, not a claim to be
a complete MCP protocol server implementation.

## Provider probes

Generic MCP mutations default to no authoritative reconciliation. If the provider profile claims a
real resolver, `register_tool()` requires a `reconcile_probe`; otherwise registration fails. Effects
with preconditions require a `prepare_probe`.

This prevents Effect Fabric from advertising reconciliation strength that the adapter cannot
actually supply.
