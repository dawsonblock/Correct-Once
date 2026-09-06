import { type ManagedPluginOrder } from "./order.js";
import type { OnRegistrar } from "./loader.js";
export interface PluginRuntimePort {
    registrar(plugin: string, order: number): OnRegistrar;
}
import type { SealedManagedConfig } from "@function-hooks/assurance";
import { type PluginAdmissionReport } from "./admission.js";
import type { PluginDescriptor } from "./manifest.js";
import { type HooksModuleLoader } from "./loader.js";
export interface PluginRegistrationReport {
    readonly order: readonly string[];
    readonly registered: readonly string[];
    readonly admission?: PluginAdmissionReport;
}
export declare function registerPlugins(runtime: PluginRuntimePort, descriptors: readonly PluginDescriptor[], managed?: ManagedPluginOrder, loader?: HooksModuleLoader): Promise<PluginRegistrationReport>;
/**
 * Two-stage registration helper: verify a sealed managed configuration and exact
 * plugin digests before executing any candidate hook module, then register only
 * the admitted set in the sealed prepend/dependency/append order.
 */
export declare function registerPluginsAssured(runtime: PluginRuntimePort, descriptors: readonly PluginDescriptor[], sealed: SealedManagedConfig, options?: {
    readonly publicKeyPem?: string;
    readonly loader?: HooksModuleLoader;
}): Promise<PluginRegistrationReport>;
//# sourceMappingURL=manager.d.ts.map