import type { SealedManagedConfig } from "@function-hooks/assurance";
import type { PluginDescriptor } from "./manifest.js";
export interface PluginAdmissionRecord {
    readonly name: string;
    readonly expectedDigest: string;
    readonly actualDigest: string;
    readonly admitted: boolean;
    readonly reason?: string;
}
export interface PluginAdmissionReport {
    readonly configHash: string;
    readonly records: readonly PluginAdmissionRecord[];
}
export declare function admitPinnedPlugins(descriptors: readonly PluginDescriptor[], sealed: SealedManagedConfig, publicKeyPem?: string): Promise<PluginAdmissionReport>;
//# sourceMappingURL=admission.d.ts.map