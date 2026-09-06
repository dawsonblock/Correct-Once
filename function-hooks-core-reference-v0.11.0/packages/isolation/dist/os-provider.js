import { basename, relative } from "node:path";
import { ProcessIsolationLoader } from "./process-loader.js";
function containerPluginPath(context) {
    const rel = relative(context.pluginRoot, context.modulePath).replaceAll("\\", "/");
    if (!rel || rel.startsWith("../") || rel === "..")
        throw new Error(`Plugin module ${context.modulePath} is outside plugin root ${context.pluginRoot}.`);
    return `/plugin/${rel}`;
}
/**
 * Build a deny-by-default rootless Podman launch plan for the existing hook RPC worker.
 * The plan uses no network, a read-only rootfs, no capabilities, no-new-privileges,
 * bounded pids/memory/CPU, read-only plugin/runtime mounts, and a small tmpfs.
 *
 * Execution requires a locally installed Podman and an image containing Node >= 20.
 */
export function createPodmanLaunchBuilder(options = {}) {
    const executable = options.podmanExecutable ?? "podman";
    const image = options.image ?? "node:22-alpine";
    const memoryMb = options.memoryMb ?? 128;
    const cpus = options.cpus ?? 1;
    const pidsLimit = options.pidsLimit ?? 64;
    const tmpfsMb = options.tmpfsMb ?? 16;
    return (context) => {
        const modulePath = containerPluginPath(context);
        const args = [
            "run", "--rm", "--interactive",
            "--network=none",
            "--read-only",
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            `--pids-limit=${pidsLimit}`,
            `--memory=${memoryMb}m`,
            `--cpus=${cpus}`,
            `--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=${tmpfsMb}m`,
            `--volume=${context.runtimeRoot}:/runtime:ro`,
            `--volume=${context.pluginRoot}:/plugin:ro`,
            "--env=FH_PLUGIN_ROOT=/plugin",
            "--env=FH_RUNTIME_ROOT=/runtime",
            ...(options.additionalArgs ?? []),
            image,
            "node",
            "--permission",
            "--allow-fs-read=/runtime",
            "--allow-fs-read=/plugin",
            "--allow-worker",
            "--no-addons",
            "--no-global-search-paths",
            `--max-old-space-size=${context.maxOldSpaceMb}`,
            "--experimental-loader=/runtime/sandbox-loader.js",
            "/runtime/worker-host.js",
            modulePath,
            context.encodedOptions,
            context.encodedGrants,
        ];
        return { command: executable, args, env: {} };
    };
}
export function summarizePodmanIsolationPlan(context, options = {}) {
    const plan = createPodmanLaunchBuilder(options)(context);
    return Object.freeze({
        executable: plan.command,
        image: options.image ?? "node:22-alpine",
        plugin: basename(context.modulePath),
        network: "none",
        rootfs: "read-only",
        capabilities: "none",
        noNewPrivileges: true,
        mounts: Object.freeze(["runtime:ro", "plugin:ro"]),
    });
}
/** Ready-to-use OS/container-backed loader using rootless Podman as the process boundary. */
export class PodmanIsolationLoader extends ProcessIsolationLoader {
    constructor(runtime, options = {}) {
        super(runtime, {
            ...(options.process ?? {}),
            launchBuilder: createPodmanLaunchBuilder(options.podman),
        });
    }
}
//# sourceMappingURL=os-provider.js.map