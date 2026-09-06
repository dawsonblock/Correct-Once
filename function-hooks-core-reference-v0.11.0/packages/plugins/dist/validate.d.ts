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
export declare function inspectPluginRegistration(descriptor: PluginDescriptor, load: (path: string) => Promise<{
    register: (on: any, options?: unknown) => unknown | Promise<unknown>;
}>): Promise<PluginValidationReport>;
//# sourceMappingURL=validate.d.ts.map