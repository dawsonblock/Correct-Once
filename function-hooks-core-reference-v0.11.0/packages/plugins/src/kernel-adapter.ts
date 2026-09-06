import type { EventMap, EventName, KernelBuilder } from "@function-hooks/core";
import { KernelPluginCompatibilityError } from "./errors.js";
import type { OnRegistrar } from "./loader.js";
import type { PluginDescriptor } from "./manifest.js";
import { registerPluginModules, TrustedInProcessLoader, type HooksModuleLoader } from "./loader.js";
import { resolvePluginOrder, type ManagedPluginOrder } from "./order.js";

/** Converts the stable builder into the legacy plugin register(on) shape for exact dispatch hooks. */
export function kernelRegistrar<M extends EventMap>(builder: KernelBuilder<M>, plugin: string, order: number): OnRegistrar {
  return ((event: string, arg2: unknown, arg3?: unknown): void => {
    if (event === "*" || event === "engine.create") throw new KernelPluginCompatibilityError(`Plugin ${plugin} uses ${event}, which is not part of the stable kernel registrar contract.`);
    const matcher = arg3 === undefined ? undefined : arg2;
    const callback = (arg3 === undefined ? arg2 : arg3) as (engine: unknown, event: unknown, next: unknown) => unknown;
    if (typeof callback !== "function") throw new TypeError(`Hook callback for ${event} must be a function.`);
    if (matcher === undefined) builder.on(plugin, order, event as EventName<M>, callback as never);
    else builder.on(plugin, order, event as EventName<M>, matcher as never, callback as never);
  }) as OnRegistrar;
}

export async function registerPluginsIntoKernel<M extends EventMap>(
  builder: KernelBuilder<M>, descriptors: readonly PluginDescriptor[], managed: ManagedPluginOrder = {}, loader: HooksModuleLoader = new TrustedInProcessLoader(),
): Promise<{ readonly order: readonly string[]; readonly registered: readonly string[] }> {
  const order = resolvePluginOrder(descriptors.map((d) => ({ name: d.manifest.name, ...(d.manifest.dependencies ? { dependencies: d.manifest.dependencies } : {}) })), managed);
  const byName = new Map(descriptors.map((d) => [d.manifest.name, d] as const));
  const registered: string[] = [];
  for (let index=0; index<order.length; index++) {
    const name = order[index]!; const descriptor = byName.get(name)!;
    await registerPluginModules(descriptor, kernelRegistrar(builder, name, index), loader);
    registered.push(name);
  }
  return Object.freeze({ order: Object.freeze(order), registered: Object.freeze(registered) });
}
