export interface IsolationRuntimePort {
    dispatch(event: string, input: unknown, explicitOrigin?: string): Promise<unknown>;
}
import type { HooksModule, HooksModuleLoader, LoaderContext } from "@function-hooks/plugins";
import { type CapabilityGrantResolver, type CapabilityGrantSet } from "./grants.js";
export interface IsolationLaunchContext {
    readonly pluginName: string;
    readonly modulePath: string;
    readonly pluginRoot: string;
    readonly runtimeRoot: string;
    readonly workerPath: string;
    readonly loaderPath: string;
    readonly encodedOptions: string;
    readonly encodedGrants: string;
    readonly maxOldSpaceMb: number;
    readonly nodeExecutable: string;
}
export interface IsolationLaunchSpec {
    readonly command: string;
    readonly args: readonly string[];
    readonly env?: Readonly<Record<string, string>>;
}
export type IsolationLaunchBuilder = (context: IsolationLaunchContext) => IsolationLaunchSpec;
export declare function buildNodePermissionLaunchSpec(context: IsolationLaunchContext): IsolationLaunchSpec;
export interface NodePermissionProcessOptions {
    readonly invocationTimeoutMs?: number;
    readonly startupTimeoutMs?: number;
    readonly maxProtocolLineBytes?: number;
    readonly maxOldSpaceMb?: number;
    readonly nodeExecutable?: string;
    /** Explicit engine capabilities visible to and callable by isolated plugins. Default: none. */
    readonly capabilityGrants?: CapabilityGrantSet | CapabilityGrantResolver;
    /** Optional stronger OS/container launcher. Defaults to the local Node permission process. */
    readonly launchBuilder?: IsolationLaunchBuilder;
}
/**
 * Runs ordinary event hooks in a separate Node process with a restrictive loader,
 * Node's permission model, no ambient process global, no global fetch/WebSocket,
 * no native addons, bounded memory, bounded protocol frames, and kill-on-timeout.
 *
 * This is a strong development/reference isolation profile, but not a substitute
 * for an OS/container/microVM boundary against malicious native/VM escape bugs.
 * `engine.create` is intentionally unavailable to isolated plugins.
 */
export declare class ProcessIsolationLoader implements HooksModuleLoader {
    #private;
    constructor(runtime: IsolationRuntimePort, options?: NodePermissionProcessOptions);
    load(modulePath: string, context?: LoaderContext): Promise<HooksModule>;
    close(): Promise<void>;
}
/** Backwards-compatible name for the default local Node permission-process profile. */
export declare class NodePermissionProcessLoader extends ProcessIsolationLoader {
}
//# sourceMappingURL=process-loader.d.ts.map