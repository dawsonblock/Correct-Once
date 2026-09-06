import { capabilitySnapshot } from "./canonical.js";
export async function projectAgentCapabilityCatalog(registry) {
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
//# sourceMappingURL=catalog.js.map