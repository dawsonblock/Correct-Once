import type { AdmittedCapability, CapabilityRegistry, CapabilityRegistryFilter, CapabilityRegistryRecord, CapabilityRegistrySnapshot } from "./types.js";
export declare class InMemoryCapabilityRegistry implements CapabilityRegistry {
    #private;
    register(capability: AdmittedCapability): Promise<CapabilityRegistryRecord>;
    get(id: string): Promise<CapabilityRegistryRecord | undefined>;
    list(filter?: CapabilityRegistryFilter): Promise<readonly CapabilityRegistryRecord[]>;
    activate(id: string, reason?: string): Promise<CapabilityRegistryRecord>;
    suspend(id: string, reason?: string): Promise<CapabilityRegistryRecord>;
    revoke(id: string, reason?: string): Promise<CapabilityRegistryRecord>;
    supersede(id: string, reason?: string): Promise<CapabilityRegistryRecord>;
    snapshot(): Promise<CapabilityRegistrySnapshot>;
}
//# sourceMappingURL=registry.d.ts.map