import { capabilitySnapshot } from "./canonical.js";
import type { AgentCapabilityCatalogEntry, CapabilityRegistry } from "./types.js";

export async function projectAgentCapabilityCatalog(registry: CapabilityRegistry): Promise<readonly AgentCapabilityCatalogEntry[]> {
  const records = await registry.list({ state: "active" });
  return Object.freeze(records.map(({ capability }) => capabilitySnapshot({
    id: capability.id,
    app: capability.app,
    capability: capability.capability,
    description: capability.description,
    inputSchema: capability.inputSchema,
    ...(capability.outputSchema === undefined ? {} : { outputSchema: capability.outputSchema }),
    sideEffect: capability.sideEffect,
    sensitivity: capability.sensitivity,
    risk: capability.risk,
    schemaHash: capability.schemaHash,
  })));
}
