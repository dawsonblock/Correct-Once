# Effect Fabric v0.2 architecture

v0.2 changes the development strategy from reimplementing every primitive to composing and
standardizing the strongest semantics found in adjacent open-source projects.

## Donor roles

- **durable-agent-outbox** — pure reducer discipline, delivery/action separation, stable idempotency,
  ambiguous outcome settlement, withdrawal/supersession truthfulness, fencing, authenticated
  receipts, negative-control conformance testing.
- **OpenOnce** — provider capability profiles and honest distinction between authoritative and
  non-authoritative reconciliation misses.
- **AgentAction** — exact-action authorization evidence and MCP authorization interoperability.
- **PALOframework** — Effect Contract vocabulary, one-use capability ideas, authoritative
  pre/post-state verification, incident/resource-hold semantics.
- **ChronoMCP** — MCP `dev.chronomcp/compensate` reversibility and deterministic compensation
  metadata.

No donor repository is vendored into the runtime.  Compatibility is implemented at schema,
protocol, adapter, and conformance boundaries.

## First v0.2 slice

This release introduces:

1. a pure deterministic lifecycle reducer scaffold;
2. an internal semantic port of the 17 durable-agent-outbox scenario names;
3. `ProviderEffectProfile`, derived from OpenOnce's provider honesty model;
4. an MCP-native `EffectRegistryV2` with schema-drift denial;
5. ChronoMCP compensation metadata ingestion;
6. external exact-action authorization evidence binding suitable for AgentAction/PALO adapters.

The existing v0.1.6 engine remains the active persistence/execution runtime.  The reducer is not yet
promoted into the production path.  Promotion requires equivalence/conformance tests and live
PostgreSQL qualification.
