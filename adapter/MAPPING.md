# Mapping table — B admitted capability → A effect registration

## Identity & lifecycle

| B symbol | A symbol | Notes |
|----------|----------|-------|
| `AdmittedCapability.id` | registration key + catalog id | Default B id = `{app}.{capability}` |
| `AdmittedCapability.app` + `.capability` | `EffectDefinitionFactory.operation` = `{app}.{capability}` | Stable semantic op name |
| `lifecycle: "admitted"` + `admission` | required before register | Adapter refuses candidates |
| `CapabilityRegistryRecord.state == "active"` | eligible for register / invoke | Suspended/revoked fail closed |
| `admission.admissionId` / `policyVersion` | `qualification_ids` + call-time scope | Integrity binding, not a crypto signature |
| `candidateHash` / `descriptorHash` / `schemaHash` | stored on adapter pin; A pins via `McpToolIdentity.schema_digest` | Digests not interchangeable A/B — pin A digest from B `inputSchema` |

## Implementation → transport

| B `implementation.kind` | A path | Curated MCP catalog? |
|-------------------------|--------|----------------------|
| `mcp` (`server`, `tool`) | `McpToolIdentity` + `EffectGateway.call_tool` | **Yes** (only this for v1) |
| `http` / `browser` / `desktop` / `process` / `filesystem.*` | B router channels | Out of curated MCP catalog |

Unknown / non-`mcp` implementations: **refuse registration** (fail closed).

## Risk / class tags

**B already has them** — do not add a new admission field.

| B `sideEffect` | Catalog tag | A `MutationClass` | A `ReversibilitySpec` |
|----------------|-------------|-------------------|----------------------|
| `read` | `read` | `READ_ONLY` | N/A (passthrough) |
| `write` | `write` | `MUTATING` | `UNKNOWN` |
| `external` | `write` | `MUTATING` | `UNKNOWN` |
| `destructive` | `destructive` | `DESTRUCTIVE` | `IRREVERSIBLE` |
| `unknown` | — | — | **Refuse registration** |

Also on B catalog: `sensitivity`, `risk`.

## Catalog tools

| Tool | Behavior |
|------|----------|
| `search_capabilities` | Semantic projection of active admitted records; omit implementation/admission/tokens |
| `invoke_capability` | Resolve id → call-time gates → `EffectGateway.call_tool` |

## Call-time allowlist plug-in (A)

Before `EffectEngine.authorize` capability mint:

1. `invoke_capability` re-loads active record by id
2. Re-verify admission hashes match frozen registration pin
3. Map `sideEffect` → allowlist class; deny if not in subject set
4. `destructive` requires `allow_destructive=True` (default OFF)
5. Delegate to `GatewayPolicy.authorize`
6. `McpMutationExecutor.execute` re-checks schema digest pre-I/O

A hook points: `EffectGateway.call_tool`, `GatewayPolicy.authorize`, `McpMutationExecutor.execute`.

## Schema digest rule

Discovery ≠ auth. Pin `digest_document(B.inputSchema)`. Drift → `DENY_SCHEMA_DRIFT`. Never mint from floating `latest`.
