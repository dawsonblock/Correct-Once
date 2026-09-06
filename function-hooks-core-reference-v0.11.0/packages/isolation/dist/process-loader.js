import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { IsolationProtocolError, IsolationTimeoutError } from "./errors.js";
import { capabilityGranted, normalizeGrantSet } from "./grants.js";
export function buildNodePermissionLaunchSpec(context) {
    return {
        command: context.nodeExecutable,
        args: [
            "--permission",
            `--allow-fs-read=${context.runtimeRoot}`,
            `--allow-fs-read=${context.pluginRoot}`,
            "--allow-worker",
            "--no-addons",
            "--no-global-search-paths",
            `--max-old-space-size=${context.maxOldSpaceMb}`,
            `--experimental-loader=${context.loaderPath}`,
            context.workerPath,
            context.modulePath,
            context.encodedOptions,
            context.encodedGrants,
        ],
        env: { FH_PLUGIN_ROOT: context.pluginRoot, FH_RUNTIME_ROOT: context.runtimeRoot },
    };
}
class IsolatedProcessSession {
    #runtime;
    #pluginName;
    #child;
    #invocationTimeoutMs;
    #maxProtocolLineBytes;
    #grants;
    #pending = new Map();
    #active = new Map();
    #buffer = "";
    #readyResolve;
    #readyReject;
    #ready;
    #closed = false;
    constructor(runtime, pluginName, child, grants, options) {
        this.#runtime = runtime;
        this.#pluginName = pluginName;
        this.#child = child;
        this.#invocationTimeoutMs = options.invocationTimeoutMs;
        this.#maxProtocolLineBytes = options.maxProtocolLineBytes;
        this.#grants = grants;
        this.#ready = new Promise((resolveReady, rejectReady) => { this.#readyResolve = resolveReady; this.#readyReject = rejectReady; });
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk) => this.#consume(chunk));
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", () => { });
        child.on("error", (error) => this.#failAll(error));
        child.on("exit", (code, signal) => {
            if (!this.#closed)
                this.#failAll(new IsolationProtocolError(`Isolated plugin ${pluginName} exited unexpectedly (code=${String(code)}, signal=${String(signal)}).`));
        });
    }
    static async start(runtime, modulePath, pluginName, pluginOptions, options) {
        const invocationTimeoutMs = options.invocationTimeoutMs ?? 5_000;
        const startupTimeoutMs = options.startupTimeoutMs ?? 5_000;
        const maxProtocolLineBytes = options.maxProtocolLineBytes ?? 1_048_576;
        const maxOldSpaceMb = options.maxOldSpaceMb ?? 96;
        const node = options.nodeExecutable ?? process.execPath;
        const isolationDir = dirname(fileURLToPath(import.meta.url));
        const workerPath = resolve(isolationDir, "worker-host.js");
        const loaderPath = resolve(isolationDir, "sandbox-loader.js");
        const pluginRoot = dirname(resolve(modulePath));
        const runtimeRoot = resolve(isolationDir);
        const encodedOptions = pluginOptions === undefined ? "" : Buffer.from(JSON.stringify(pluginOptions), "utf8").toString("base64url");
        const configuredGrants = typeof options.capabilityGrants === "function" ? options.capabilityGrants(pluginName) : options.capabilityGrants;
        const grants = normalizeGrantSet(configuredGrants);
        const encodedGrants = Buffer.from(JSON.stringify(grants), "utf8").toString("base64url");
        const launchContext = {
            pluginName,
            modulePath: resolve(modulePath),
            pluginRoot,
            runtimeRoot,
            workerPath,
            loaderPath,
            encodedOptions,
            encodedGrants,
            maxOldSpaceMb,
            nodeExecutable: node,
        };
        const launch = (options.launchBuilder ?? buildNodePermissionLaunchSpec)(launchContext);
        const child = spawn(launch.command, launch.args, {
            stdio: ["pipe", "pipe", "pipe"],
            env: launch.env ?? {},
            windowsHide: true,
        });
        const session = new IsolatedProcessSession(runtime, pluginName, child, grants, { invocationTimeoutMs, maxProtocolLineBytes });
        const timeout = setTimeout(() => session.#readyReject(new IsolationTimeoutError(`Isolated plugin ${pluginName} did not start within ${startupTimeoutMs}ms.`)), startupTimeoutMs);
        try {
            await session.#ready;
            return session;
        }
        catch (error) {
            await session.close();
            throw error;
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async attach(on) {
        const hooks = await this.#ready;
        for (const descriptor of hooks) {
            const callback = async (_engine, event, next) => this.#invoke(descriptor.hookId, event, next);
            if (descriptor.matcher === undefined)
                on(descriptor.event, callback);
            else
                on(descriptor.event, descriptor.matcher, callback);
        }
    }
    async close() {
        if (this.#closed)
            return;
        this.#closed = true;
        this.#child.kill("SIGTERM");
        this.#failAll(new IsolationProtocolError(`Isolated plugin ${this.#pluginName} closed.`));
    }
    #send(message) {
        if (this.#closed || !this.#child.stdin.writable)
            throw new IsolationProtocolError(`Isolated plugin ${this.#pluginName} is not writable.`);
        const line = `${JSON.stringify(message)}\n`;
        if (Buffer.byteLength(line, "utf8") > this.#maxProtocolLineBytes)
            throw new IsolationProtocolError("Outbound isolation protocol message exceeds size limit.");
        this.#child.stdin.write(line);
    }
    async #invoke(hookId, event, next) {
        const id = randomUUID();
        const promise = new Promise((resolvePending, rejectPending) => {
            const timer = setTimeout(() => {
                this.#pending.delete(id);
                this.#active.delete(id);
                this.#child.kill("SIGKILL");
                rejectPending(new IsolationTimeoutError(`Isolated hook ${this.#pluginName}/${hookId} exceeded ${this.#invocationTimeoutMs}ms; plugin process killed.`));
            }, this.#invocationTimeoutMs);
            this.#pending.set(id, { resolve: resolvePending, reject: rejectPending, timer });
        });
        this.#active.set(id, { next });
        const onAbort = () => {
            try {
                this.#send({ type: "cancel", id });
            }
            catch { }
        };
        next.signal.addEventListener("abort", onAbort, { once: true });
        this.#send({ type: "invoke", id, hookId, event, meta: { event: next.event, origin: next.origin } });
        try {
            return await promise;
        }
        finally {
            next.signal.removeEventListener("abort", onAbort);
            this.#active.delete(id);
        }
    }
    #consume(chunk) {
        this.#buffer += chunk;
        if (Buffer.byteLength(this.#buffer, "utf8") > this.#maxProtocolLineBytes * 2) {
            this.#failAll(new IsolationProtocolError("Isolation protocol buffer exceeded limit."));
            this.#child.kill("SIGKILL");
            return;
        }
        while (true) {
            const newline = this.#buffer.indexOf("\n");
            if (newline < 0)
                break;
            const line = this.#buffer.slice(0, newline);
            this.#buffer = this.#buffer.slice(newline + 1);
            if (!line.trim())
                continue;
            if (Buffer.byteLength(line, "utf8") > this.#maxProtocolLineBytes) {
                this.#failAll(new IsolationProtocolError("Isolation protocol line exceeded limit."));
                this.#child.kill("SIGKILL");
                return;
            }
            try {
                void this.#handle(JSON.parse(line));
            }
            catch (error) {
                this.#failAll(new IsolationProtocolError(`Malformed isolation protocol message: ${error instanceof Error ? error.message : String(error)}`));
                this.#child.kill("SIGKILL");
            }
        }
    }
    async #handle(message) {
        if (message.type === "ready") {
            this.#readyResolve(Object.freeze([...message.hooks]));
            return;
        }
        if (message.type === "fatal") {
            this.#readyReject(new IsolationProtocolError(message.error));
            return;
        }
        if (message.type === "invokeResult") {
            const pending = this.#pending.get(message.id);
            if (!pending)
                return;
            this.#pending.delete(message.id);
            clearTimeout(pending.timer);
            if (message.ok)
                pending.resolve(message.value);
            else
                pending.reject(new IsolationProtocolError(message.error));
            return;
        }
        if (message.type !== "request")
            return;
        const active = this.#active.get(message.invocationId);
        if (!active) {
            this.#send({ type: "response", id: message.id, ok: false, error: `Unknown invocation ${message.invocationId}` });
            return;
        }
        try {
            if (message.method === "engine" && !capabilityGranted(this.#grants, message.event)) {
                throw new Error(`Capability ${message.event} is not granted to isolated plugin ${this.#pluginName}.`);
            }
            const value = message.method === "next"
                ? await active.next(message.value)
                : await this.#runtime.dispatch(message.event, message.value, this.#pluginName);
            this.#send({ type: "response", id: message.id, ok: true, ...(value === undefined ? {} : { value }) });
        }
        catch (error) {
            this.#send({ type: "response", id: message.id, ok: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
        }
    }
    #failAll(error) {
        this.#readyReject(error);
        for (const [id, pending] of this.#pending) {
            clearTimeout(pending.timer);
            pending.reject(error);
            this.#pending.delete(id);
        }
    }
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
export class ProcessIsolationLoader {
    #runtime;
    #options;
    #sessions = [];
    constructor(runtime, options = {}) {
        this.#runtime = runtime;
        this.#options = options;
    }
    async load(modulePath, context) {
        const pluginName = context?.pluginName ?? `isolated:${modulePath}`;
        return {
            register: async (on, options) => {
                const session = await IsolatedProcessSession.start(this.#runtime, modulePath, pluginName, options, this.#options);
                this.#sessions.push(session);
                await session.attach(on);
            },
        };
    }
    async close() {
        await Promise.all(this.#sessions.map((session) => session.close()));
        this.#sessions.length = 0;
    }
}
/** Backwards-compatible name for the default local Node permission-process profile. */
export class NodePermissionProcessLoader extends ProcessIsolationLoader {
}
//# sourceMappingURL=process-loader.js.map