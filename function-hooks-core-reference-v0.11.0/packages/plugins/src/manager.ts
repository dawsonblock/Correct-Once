import { resolvePluginOrder, type ManagedPluginOrder } from "./order.js";
import type { OnRegistrar } from "./loader.js";
export interface PluginRuntimePort { registrar(plugin: string, order: number): OnRegistrar; }
import type { SealedManagedConfig } from "@function-hooks/assurance";
import { admitPinnedPlugins, type PluginAdmissionReport } from "./admission.js";
import type { PluginDescriptor } from "./manifest.js";
import { registerPluginModules, TrustedInProcessLoader, type HooksModuleLoader } from "./loader.js";

export interface PluginRegistrationReport {
  readonly order: readonly string[];
  readonly registered: readonly string[];
  readonly admission?: PluginAdmissionReport;
}

export async function registerPlugins(
  runtime: PluginRuntimePort,
  descriptors: readonly PluginDescriptor[],
  managed: ManagedPluginOrder = {},
  loader: HooksModuleLoader = new TrustedInProcessLoader(),
): Promise<PluginRegistrationReport> {
  const order = resolvePluginOrder(
    descriptors.map((descriptor) => ({
      name: descriptor.manifest.name,
      ...(descriptor.manifest.dependencies === undefined ? {} : { dependencies: descriptor.manifest.dependencies }),
    })),
    managed,
  );
  const byName = new Map(descriptors.map((descriptor) => [descriptor.manifest.name, descriptor] as const));
  const registered: string[] = [];
  for (let index = 0; index < order.length; index += 1) {
    const name = order[index]!;
    const descriptor = byName.get(name)!;
    await registerPluginModules(descriptor, runtime.registrar(name, index), loader);
    registered.push(name);
  }
  return Object.freeze({ order: Object.freeze(order), registered: Object.freeze(registered) });
}

/**
 * Two-stage registration helper: verify a sealed managed configuration and exact
 * plugin digests before executing any candidate hook module, then register only
 * the admitted set in the sealed prepend/dependency/append order.
 */
export async function registerPluginsAssured(
  runtime: PluginRuntimePort,
  descriptors: readonly PluginDescriptor[],
  sealed: SealedManagedConfig,
  options: { readonly publicKeyPem?: string; readonly loader?: HooksModuleLoader } = {},
): Promise<PluginRegistrationReport> {
  const admission = await admitPinnedPlugins(descriptors, sealed, options.publicKeyPem);
  const registered = await registerPlugins(runtime, descriptors, {
    ...(sealed.config.prepend ? { prepend: sealed.config.prepend } : {}),
    ...(sealed.config.append ? { append: sealed.config.append } : {}),
  }, options.loader ?? new TrustedInProcessLoader());
  return Object.freeze({ ...registered, admission });
}
