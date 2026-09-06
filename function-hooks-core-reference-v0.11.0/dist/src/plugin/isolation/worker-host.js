import process from "node:process";
import { pathToFileURL } from "node:url";
import { capabilityGranted, normalizeGrantSet, visibleNouns } from "./grants.js";
const modulePath = process.argv[2];
const optionsEncoded = process.argv[3] ?? "";
const grantsEncoded = process.argv[4] ?? "";
if (!modulePath)
    throw new Error("worker-host requires a plugin module path.");
const options = optionsEncoded ? JSON.parse(Buffer.from(optionsEncoded, "base64url").toString("utf8")) : undefined;
const grants = normalizeGrantSet(grantsEncoded ? JSON.parse(Buffer.from(grantsEncoded, "base64url").toString("utf8")) : undefined);
const nouns = visibleNouns(grants);
const protocolWrite = process.stdout.write.bind(process.stdout);
const stderrWrite = process.stderr.write.bind(process.stderr);
const safeConsole = (...args) => stderrWrite(`[isolated-plugin] ${args.map(String).join(" ")}\n`);
Object.assign(console, { log: safeConsole, info: safeConsole, warn: safeConsole, error: safeConsole, debug: safeConsole });
for (const key of Object.keys(process.env))
    delete process.env[key];
for (const name of ["fetch", "WebSocket", "EventSource"]) {
    try {
        Object.defineProperty(globalThis, name, { value: undefined, configurable: false, writable: false });
    }
    catch { }
}
try {
    Object.defineProperty(globalThis, "process", { value: undefined, configurable: false, writable: false });
}
catch { }
function send(message) {
    protocolWrite(`${JSON.stringify(message)}\n`);
}
let counter = 0;
const pending = new Map();
const hooks = new Map();
const descriptors = [];
const controllers = new Map();
function request(invocationId, method, value, event) {
    const id = `r${counter++}`;
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        if (method === "next")
            send({ type: "request", id, invocationId, method, value });
        else
            send({ type: "request", id, invocationId, method, event: event, value });
    });
}
function engineProxy(invocationId) {
    return new Proxy(Object.freeze({}), {
        get(_target, noun) {
            if (typeof noun !== "string")
                return undefined;
            if (!nouns.has("*") && !nouns.has(noun))
                return undefined;
            return new Proxy(Object.freeze({}), {
                get(_table, event) {
                    if (typeof event !== "string")
                        return undefined;
                    const full = `${noun}.${event}`;
                    if (!capabilityGranted(grants, full))
                        return undefined;
                    return (input) => request(invocationId, "engine", input, full);
                },
                has(_table, event) {
                    return typeof event === "string" && capabilityGranted(grants, `${noun}.${event}`);
                },
            });
        },
        has(_target, noun) {
            return typeof noun === "string" && (nouns.has("*") || nouns.has(noun));
        },
    });
}
async function boot() {
    const loaded = await import(pathToFileURL(modulePath).href);
    if (typeof loaded.register !== "function")
        throw new TypeError(`${modulePath} must export register(on, options).`);
    let hookOrder = 0;
    const on = (event, arg2, arg3) => {
        if (typeof event !== "string")
            throw new TypeError("Hook event name must be a string.");
        if (event === "engine.create")
            throw new Error("Isolated untrusted plugins may not register engine.create hooks; engine shape authority is bootstrap-trusted only.");
        const matcher = arg3 === undefined ? undefined : arg2;
        const callback = (arg3 === undefined ? arg2 : arg3);
        if (typeof callback !== "function")
            throw new TypeError(`Hook callback for ${event} must be a function.`);
        const hookId = `h${hookOrder++}`;
        hooks.set(hookId, callback);
        descriptors.push(Object.freeze({ hookId, event, ...(matcher === undefined ? {} : { matcher }) }));
    };
    await loaded.register(on, options);
    send({ type: "ready", hooks: descriptors });
}
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
    buffer += chunk;
    while (true) {
        const newline = buffer.indexOf("\n");
        if (newline < 0)
            break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim())
            continue;
        void handle(JSON.parse(line));
    }
});
async function handle(message) {
    if (message.type === "response") {
        const waiter = pending.get(message.id);
        if (!waiter)
            return;
        pending.delete(message.id);
        if (message.ok)
            waiter.resolve(message.value);
        else
            waiter.reject(new Error(message.error));
        return;
    }
    if (message.type === "cancel") {
        controllers.get(message.id)?.abort("host-cancelled");
        return;
    }
    if (message.type !== "invoke")
        return;
    const callback = hooks.get(message.hookId);
    if (!callback) {
        send({ type: "invokeResult", id: message.id, ok: false, error: `Unknown isolated hook ${message.hookId}` });
        return;
    }
    const controller = new AbortController();
    controllers.set(message.id, controller);
    const next = ((forwarded) => request(message.id, "next", forwarded));
    Object.defineProperties(next, {
        signal: { value: controller.signal, enumerable: true },
        event: { value: message.meta.event, enumerable: true },
        origin: { value: message.meta.origin, enumerable: true },
        is: { value: (type, _candidate) => type === message.meta.event, enumerable: true },
    });
    Object.freeze(next);
    try {
        const value = await callback(engineProxy(message.id), message.event, next);
        send({ type: "invokeResult", id: message.id, ok: true, ...(value === undefined ? {} : { value }) });
    }
    catch (error) {
        send({ type: "invokeResult", id: message.id, ok: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
    }
    finally {
        controllers.delete(message.id);
    }
}
boot().catch((error) => {
    send({ type: "fatal", error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
    process.exitCode = 1;
});
//# sourceMappingURL=worker-host.js.map