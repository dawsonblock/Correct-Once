import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
export interface PluginNext { (event: unknown): Promise<unknown>; readonly signal: AbortSignal; readonly event: string; readonly origin: string; }
export interface OnRegistrar {
  (event: string, callback: (engine: unknown, event: unknown, next: PluginNext) => unknown | Promise<unknown>): void;
  (event: string, matcher: unknown, callback: (engine: unknown, event: unknown, next: PluginNext) => unknown | Promise<unknown>): void;
}
import type { PluginDescriptor } from "./manifest.js";

export interface HooksModule {
  readonly register: (on: OnRegistrar, options?: unknown) => void | Promise<void>;
}

export interface LoaderContext {
  readonly pluginName: string;
}

export interface HooksModuleLoader {
  load(modulePath: string, context?: LoaderContext): Promise<HooksModule>;
}

/**
 * Trusted development loader. It imports a plugin in the host Node process.
 * This is intentionally NOT represented as a security boundary.
 */
export class TrustedInProcessLoader implements HooksModuleLoader {
  async load(modulePath: string): Promise<HooksModule> {
    const loaded = await import(pathToFileURL(modulePath).href) as Partial<HooksModule>;
    if (typeof loaded.register !== "function") throw new TypeError(`${modulePath} must export register(on, options).`);
    return loaded as HooksModule;
  }
}

export async function registerPluginModules(
  descriptor: PluginDescriptor,
  on: OnRegistrar,
  loader: HooksModuleLoader,
): Promise<void> {
  for (const moduleName of descriptor.hooks.modules ?? []) {
    const path = resolve(descriptor.directory, "hooks", moduleName);
    const module = await loader.load(path, { pluginName: descriptor.manifest.name });
    await module.register(on, descriptor.options ?? descriptor.manifest.userConfig);
  }
}
