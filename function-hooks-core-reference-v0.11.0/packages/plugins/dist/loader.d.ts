export interface PluginNext {
    (event: unknown): Promise<unknown>;
    readonly signal: AbortSignal;
    readonly event: string;
    readonly origin: string;
}
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
export declare class TrustedInProcessLoader implements HooksModuleLoader {
    load(modulePath: string): Promise<HooksModule>;
}
export declare function registerPluginModules(descriptor: PluginDescriptor, on: OnRegistrar, loader: HooksModuleLoader): Promise<void>;
//# sourceMappingURL=loader.d.ts.map