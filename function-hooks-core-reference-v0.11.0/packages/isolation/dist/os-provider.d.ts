import { ProcessIsolationLoader, type IsolationLaunchBuilder, type IsolationLaunchContext, type NodePermissionProcessOptions } from "./process-loader.js";
import type { IsolationRuntimePort } from "./process-loader.js";
export interface PodmanSandboxOptions {
    readonly podmanExecutable?: string;
    readonly image?: string;
    readonly memoryMb?: number;
    readonly cpus?: number;
    readonly pidsLimit?: number;
    readonly tmpfsMb?: number;
    readonly additionalArgs?: readonly string[];
}
/**
 * Build a deny-by-default rootless Podman launch plan for the existing hook RPC worker.
 * The plan uses no network, a read-only rootfs, no capabilities, no-new-privileges,
 * bounded pids/memory/CPU, read-only plugin/runtime mounts, and a small tmpfs.
 *
 * Execution requires a locally installed Podman and an image containing Node >= 20.
 */
export declare function createPodmanLaunchBuilder(options?: PodmanSandboxOptions): IsolationLaunchBuilder;
export declare function summarizePodmanIsolationPlan(context: IsolationLaunchContext, options?: PodmanSandboxOptions): Readonly<Record<string, unknown>>;
export interface PodmanIsolationLoaderOptions {
    readonly podman?: PodmanSandboxOptions;
    readonly process?: Omit<NodePermissionProcessOptions, "launchBuilder">;
}
/** Ready-to-use OS/container-backed loader using rootless Podman as the process boundary. */
export declare class PodmanIsolationLoader extends ProcessIsolationLoader {
    constructor(runtime: IsolationRuntimePort, options?: PodmanIsolationLoaderOptions);
}
//# sourceMappingURL=os-provider.d.ts.map