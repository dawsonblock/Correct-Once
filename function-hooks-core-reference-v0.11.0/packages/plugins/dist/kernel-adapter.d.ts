import type { EventMap, KernelBuilder } from "@function-hooks/core";
import type { OnRegistrar } from "./loader.js";
import type { PluginDescriptor } from "./manifest.js";
import { type HooksModuleLoader } from "./loader.js";
import { type ManagedPluginOrder } from "./order.js";
/** Converts the stable builder into the legacy plugin register(on) shape for exact dispatch hooks. */
export declare function kernelRegistrar<M extends EventMap>(builder: KernelBuilder<M>, plugin: string, order: number): OnRegistrar;
export declare function registerPluginsIntoKernel<M extends EventMap>(builder: KernelBuilder<M>, descriptors: readonly PluginDescriptor[], managed?: ManagedPluginOrder, loader?: HooksModuleLoader): Promise<{
    readonly order: readonly string[];
    readonly registered: readonly string[];
}>;
//# sourceMappingURL=kernel-adapter.d.ts.map