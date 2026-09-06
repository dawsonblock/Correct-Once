import type { PluginDescriptor } from "./manifest.js";

export interface PluginValidationReport {
  readonly plugin: string;
  readonly modules: readonly string[];
  readonly declaredEvents: readonly string[];
}

/**
 * Registration-time validation works by supplying a recorder instead of a live
 * runtime registrar. No hook is dispatched while the module declares hooks.
 */
export async function inspectPluginRegistration(
  descriptor: PluginDescriptor,
  load: (path: string) => Promise<{ register: (on: any, options?: unknown) => unknown | Promise<unknown> }>,
): Promise<PluginValidationReport> {
  const events: string[] = [];
  const on = (event: string, arg2: unknown, arg3?: unknown): void => {
    const callback = arg3 === undefined ? arg2 : arg3;
    if (typeof callback !== "function") throw new TypeError(`Hook callback for ${event} must be a function.`);
    events.push(event);
  };
  for (const moduleName of descriptor.hooks.modules ?? []) {
    const module = await load(`${descriptor.directory}/hooks/${moduleName}`);
    await module.register(on, descriptor.options ?? descriptor.manifest.userConfig);
  }
  return {
    plugin: descriptor.manifest.name,
    modules: [...(descriptor.hooks.modules ?? [])],
    declaredEvents: events,
  };
}
