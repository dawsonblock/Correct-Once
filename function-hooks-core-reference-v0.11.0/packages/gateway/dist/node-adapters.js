import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { GatewayAdapterUnavailableError, GatewayExecutionError, GatewayHostPolicyError, GatewayOutputLimitError } from "./errors.js";
function inside(root, candidate) {
    const rel = relative(root, candidate);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
async function secureLinuxFilesystemAvailable() {
    if (process.platform !== "linux")
        return false;
    try {
        return (await realpath("/proc/self/fd")).length > 0;
    }
    catch {
        return false;
    }
}
async function scopedReadPath(root, requested) {
    const lexical = resolve(root, requested);
    if (!inside(root, lexical))
        throw new GatewayHostPolicyError(`Path ${requested} escapes configured root.`);
    let actual;
    try {
        actual = await realpath(lexical);
    }
    catch (error) {
        throw new GatewayExecutionError(`Cannot resolve read path ${requested}.`, { cause: error });
    }
    if (!inside(root, actual))
        throw new GatewayHostPolicyError(`Path ${requested} resolves outside configured root.`);
    return actual;
}
async function scopedDirectory(root, requested) {
    const actual = await scopedReadPath(root, requested);
    const stat = await lstat(actual);
    if (!stat.isDirectory())
        throw new GatewayHostPolicyError(`Working directory ${requested} is not a directory.`);
    return actual;
}
async function scopedWritePath(root, requested) {
    const lexical = resolve(root, requested);
    if (!inside(root, lexical))
        throw new GatewayHostPolicyError(`Path ${requested} escapes configured fsRoot.`);
    let parent;
    try {
        parent = await realpath(dirname(lexical));
    }
    catch (error) {
        throw new GatewayExecutionError(`Parent directory for ${requested} does not exist.`, { cause: error });
    }
    if (!inside(root, parent))
        throw new GatewayHostPolicyError(`Parent of ${requested} resolves outside configured fsRoot.`);
    try {
        const stat = await lstat(lexical);
        if (stat.isSymbolicLink())
            throw new GatewayHostPolicyError(`Refusing to write through symbolic link ${requested}.`);
        const actual = await realpath(lexical);
        if (!inside(root, actual))
            throw new GatewayHostPolicyError(`Path ${requested} resolves outside configured fsRoot.`);
    }
    catch (error) {
        if (error.code !== "ENOENT")
            throw error;
    }
    return lexical;
}
async function withAnchoredParent(root, requested, operation) {
    const lexical = resolve(root, requested);
    if (!inside(root, lexical))
        throw new GatewayHostPolicyError(`Path ${requested} escapes configured fsRoot.`);
    const requestedParent = dirname(lexical);
    const name = basename(lexical);
    if (!name || name === "." || name === "..")
        throw new GatewayHostPolicyError(`Path ${requested} does not name a file.`);
    let actualParent;
    try {
        actualParent = await realpath(requestedParent);
    }
    catch (error) {
        throw new GatewayExecutionError(`Parent directory for ${requested} does not exist.`, { cause: error });
    }
    if (!inside(root, actualParent))
        throw new GatewayHostPolicyError(`Parent of ${requested} resolves outside configured fsRoot.`);
    const parentHandle = await open(actualParent, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
    try {
        const parentFdPath = `/proc/self/fd/${parentHandle.fd}`;
        const anchoredParent = await realpath(parentFdPath);
        if (!inside(root, anchoredParent))
            throw new GatewayHostPolicyError(`Anchored parent for ${requested} escaped configured fsRoot.`);
        return await operation(parentFdPath, name, parentHandle);
    }
    finally {
        await parentHandle.close();
    }
}
async function secureReadFile(root, requested, maxBytes) {
    return withAnchoredParent(root, requested, async (parentFdPath, name) => {
        let handle;
        try {
            handle = await open(`${parentFdPath}/${name}`, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
        }
        catch (error) {
            if (error?.code === "ELOOP")
                throw new GatewayHostPolicyError(`Refusing to read through symbolic link ${requested}.`);
            throw new GatewayExecutionError(`Cannot securely open read path ${requested}.`, { cause: error });
        }
        try {
            const stat = await handle.stat();
            if (!stat.isFile())
                throw new GatewayHostPolicyError(`Read path ${requested} is not a regular file.`);
            if (stat.size > maxBytes)
                throw new GatewayOutputLimitError(`File ${requested} exceeds ${maxBytes} bytes.`);
            const openedTarget = await realpath(`/proc/self/fd/${handle.fd}`);
            if (!inside(root, openedTarget))
                throw new GatewayHostPolicyError(`Opened file ${requested} resolves outside configured fsRoot.`);
            const data = await handle.readFile({ encoding: "utf8" });
            const bytes = Buffer.byteLength(data);
            if (bytes > maxBytes)
                throw new GatewayOutputLimitError(`File ${requested} exceeds ${maxBytes} bytes.`);
            return Object.freeze({ data, bytes });
        }
        finally {
            await handle.close();
        }
    });
}
async function secureWriteFile(root, requested, data, maxBytes) {
    const bytes = Buffer.byteLength(data);
    if (bytes > maxBytes)
        throw new GatewayOutputLimitError(`File write ${requested} exceeds ${maxBytes} bytes.`);
    return withAnchoredParent(root, requested, async (parentFdPath, name, parentHandle) => {
        const target = `${parentFdPath}/${name}`;
        try {
            const existing = await lstat(target);
            if (existing.isSymbolicLink())
                throw new GatewayHostPolicyError(`Refusing to replace symbolic link ${requested}.`);
            if (!existing.isFile())
                throw new GatewayHostPolicyError(`Write path ${requested} is not a regular file.`);
        }
        catch (error) {
            if (error?.code !== "ENOENT")
                throw error;
        }
        const tempName = `.function-hooks-${process.pid}-${randomUUID()}.tmp`;
        const temp = `${parentFdPath}/${tempName}`;
        let handle;
        try {
            handle = await open(temp, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);
            await handle.writeFile(data, "utf8");
            await handle.sync();
            await handle.close();
            handle = undefined;
            await rename(temp, target);
            try {
                await parentHandle.sync();
            }
            catch { /* some filesystems do not support directory fsync */ }
        }
        catch (error) {
            if (handle) {
                try {
                    await handle.close();
                }
                catch { /* best effort */ }
            }
            try {
                await unlink(temp);
            }
            catch { /* best effort */ }
            throw error;
        }
        return Object.freeze({ bytesWritten: bytes });
    });
}
async function sha256File(path) {
    const bytes = await readFile(path);
    return createHash("sha256").update(bytes).digest("hex");
}
async function resolveProcessProfiles(profiles, fsRoot) {
    const out = new Map();
    for (const profile of profiles ?? []) {
        if (!profile.id.trim())
            throw new GatewayHostPolicyError("Process profile id must be non-empty.");
        if (out.has(profile.id))
            throw new GatewayHostPolicyError(`Duplicate process profile ${profile.id}.`);
        if (!isAbsolute(profile.executable))
            throw new GatewayHostPolicyError(`Executable for process profile ${profile.id} must be absolute.`);
        const executable = await realpath(profile.executable);
        const executableStat = await lstat(executable);
        if (!executableStat.isFile())
            throw new GatewayHostPolicyError(`Executable for process profile ${profile.id} is not a regular file.`);
        if (profile.cwdRoot !== undefined)
            await scopedDirectory(fsRoot, profile.cwdRoot);
        if (profile.fixedArgs !== undefined && !profile.fixedArgs.every((entry) => typeof entry === "string"))
            throw new GatewayHostPolicyError(`Fixed arguments for process profile ${profile.id} must be strings.`);
        if (profile.environment !== undefined)
            for (const [key, value] of Object.entries(profile.environment))
                if (!key || typeof value !== "string")
                    throw new GatewayHostPolicyError(`Environment for process profile ${profile.id} must contain non-empty string keys and string values.`);
        for (const [field, value] of [["maxTimeoutMs", profile.maxTimeoutMs], ["maxOutputBytes", profile.maxOutputBytes]])
            if (value !== undefined && (!Number.isFinite(value) || value <= 0))
                throw new GatewayHostPolicyError(`${field} for process profile ${profile.id} must be a finite positive number.`);
        if (profile.executableSha256) {
            if (!/^[a-fA-F0-9]{64}$/.test(profile.executableSha256))
                throw new GatewayHostPolicyError(`Executable SHA-256 for process profile ${profile.id} is invalid.`);
            const actual = await sha256File(executable);
            if (actual !== profile.executableSha256.toLowerCase())
                throw new GatewayHostPolicyError(`Executable SHA-256 mismatch for process profile ${profile.id}.`);
        }
        out.set(profile.id, Object.freeze({ ...profile, executable, ...(profile.fixedArgs === undefined ? {} : { fixedArgs: Object.freeze([...profile.fixedArgs]) }), ...(profile.environment === undefined ? {} : { environment: Object.freeze({ ...profile.environment }) }) }));
    }
    return out;
}
function killTree(child, signal, mode) {
    const pid = child.pid;
    if (!pid)
        return;
    if (mode === "process-group" && process.platform !== "win32") {
        try {
            process.kill(-pid, signal);
            return;
        }
        catch { /* fall back to direct child */ }
    }
    if (mode === "process-group" && process.platform === "win32" && signal === "SIGKILL") {
        try {
            spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
            return;
        }
        catch { /* fall through */ }
    }
    try {
        child.kill(signal);
    }
    catch { /* best effort */ }
}
async function execProcess(input, context, options, root, profiles) {
    let command;
    let args;
    let cwdRoot = root;
    let childEnvironment;
    let profileTimeout;
    let profileOutput;
    if (input.profile !== undefined) {
        const profile = profiles.get(input.profile);
        if (!profile)
            throw new GatewayHostPolicyError(`Process profile ${input.profile} is not configured by the host adapter.`);
        const callerArgs = Object.freeze([...(input.args ?? [])]);
        if (!(profile.validateArgs ? profile.validateArgs(callerArgs) : callerArgs.length === 0))
            throw new GatewayHostPolicyError(`Arguments are not allowed by process profile ${input.profile}.`);
        if (profile.executableSha256) {
            const actual = await sha256File(profile.executable);
            if (actual !== profile.executableSha256.toLowerCase())
                throw new GatewayHostPolicyError(`Executable SHA-256 changed for process profile ${input.profile}.`);
        }
        command = profile.executable;
        args = Object.freeze([...(profile.fixedArgs ?? []), ...callerArgs]);
        cwdRoot = profile.cwdRoot === undefined ? root : await scopedDirectory(root, profile.cwdRoot);
        childEnvironment = Object.freeze({ ...(profile.environment ?? {}) });
        profileTimeout = profile.maxTimeoutMs;
        profileOutput = profile.maxOutputBytes;
    }
    else {
        if (!options.allowLegacyProcessCommands)
            throw new GatewayHostPolicyError("Raw process commands are disabled. Configure a process profile or explicitly enable legacy raw commands.");
        const commandValue = input.command ?? "";
        const allowed = new Set(options.processCommands ?? []);
        if (!allowed.has(commandValue))
            throw new GatewayHostPolicyError(`Legacy process command ${commandValue} is not allowed by the host adapter.`);
        command = commandValue;
        args = Object.freeze([...(input.args ?? [])]);
        childEnvironment = Object.freeze({ ...(options.processEnvironment ?? {}) });
    }
    const cwd = input.cwd ? await scopedDirectory(cwdRoot, input.cwd) : cwdRoot;
    const hostMaxTimeout = options.maxProcessTimeoutMs ?? 30_000;
    const maxTimeout = Math.min(hostMaxTimeout, profileTimeout ?? hostMaxTimeout);
    const timeoutMs = Math.min(input.timeoutMs ?? maxTimeout, maxTimeout);
    const hostMaxOutput = options.maxOutputBytes ?? 1_048_576;
    const maxOutput = Math.min(hostMaxOutput, profileOutput ?? hostMaxOutput);
    const treeMode = options.processTreeIsolation ?? "process-group";
    const killGraceMs = options.processKillGraceMs ?? 150;
    return new Promise((resolvePromise, rejectPromise) => {
        let stdout = "";
        let stderr = "";
        let settled = false;
        let outputBytes = 0;
        let closed = false;
        let terminating = false;
        let forceKillTimer;
        let timer;
        const child = spawn(command, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"], env: { ...childEnvironment }, detached: treeMode === "process-group" && process.platform !== "win32", windowsHide: true });
        const cleanup = () => { if (timer !== undefined)
            clearTimeout(timer); context.signal.removeEventListener("abort", onAbort); };
        const finishError = (error) => { if (settled)
            return; settled = true; cleanup(); rejectPromise(error); };
        const terminate = (error) => {
            if (settled)
                return;
            terminating = true;
            killTree(child, "SIGTERM", treeMode);
            forceKillTimer = setTimeout(() => { killTree(child, "SIGKILL", treeMode); }, killGraceMs);
            finishError(error);
        };
        const onAbort = () => terminate(new GatewayExecutionError(`Process ${input.profile ?? command} was cancelled.`));
        timer = setTimeout(() => terminate(new GatewayExecutionError(`Process ${input.profile ?? command} exceeded ${timeoutMs}ms.`)), timeoutMs);
        context.signal.addEventListener("abort", onAbort, { once: true });
        child.on("error", (error) => finishError(new GatewayExecutionError(`Failed to start process ${input.profile ?? command}.`, { cause: error })));
        const collect = (kind, chunk) => { outputBytes += chunk.byteLength; if (outputBytes > maxOutput) {
            terminate(new GatewayOutputLimitError(`Process output exceeded ${maxOutput} bytes.`));
            return;
        } if (kind === "stdout")
            stdout += chunk.toString("utf8");
        else
            stderr += chunk.toString("utf8"); };
        child.stdout?.on("data", (chunk) => collect("stdout", chunk));
        child.stderr?.on("data", (chunk) => collect("stderr", chunk));
        child.on("close", (code) => {
            closed = true;
            // During forced termination, keep the group-kill timer alive even if the leader exits;
            // descendants may still be running in the same process group.
            if (!terminating && forceKillTimer !== undefined)
                clearTimeout(forceKillTimer);
            if (settled)
                return;
            settled = true;
            cleanup();
            resolvePromise(Object.freeze({ exitCode: code ?? -1, stdout, stderr }));
        });
    });
}
const blockedAddresses = new BlockList();
for (const [network, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]])
    blockedAddresses.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["100::", 64], ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]])
    blockedAddresses.addSubnet(network, prefix, "ipv6");
function addressAllowed(address, family, allowPrivate) {
    if (allowPrivate)
        return true;
    return !blockedAddresses.check(address, family === 6 ? "ipv6" : "ipv4");
}
async function resolvePinnedAddress(url, allowPrivate) {
    const host = url.hostname.startsWith("[") && url.hostname.endsWith("]") ? url.hostname.slice(1, -1) : url.hostname;
    const literalFamily = isIP(host);
    const answers = literalFamily ? [{ address: host, family: literalFamily }] : await lookup(host, { all: true, verbatim: true });
    if (answers.length === 0)
        throw new GatewayHostPolicyError(`DNS resolution for ${host} returned no addresses.`);
    for (const answer of answers)
        if (!addressAllowed(answer.address, answer.family, allowPrivate))
            throw new GatewayHostPolicyError(`Network host ${host} resolved to prohibited address ${answer.address}.`);
    return answers[0];
}
async function requestNetwork(input, context, options) {
    let url;
    try {
        url = new URL(input.url);
    }
    catch {
        throw new GatewayHostPolicyError(`Invalid URL ${input.url}.`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:")
        throw new GatewayHostPolicyError(`Network scheme ${url.protocol} is not allowed.`);
    if (url.username || url.password)
        throw new GatewayHostPolicyError("Credentials embedded in network URLs are not allowed.");
    if (!new Set(options.networkOrigins ?? []).has(url.origin))
        throw new GatewayHostPolicyError(`Network origin ${url.origin} is not allowed by the host adapter.`);
    const method = (input.method ?? "GET").toUpperCase();
    if (!new Set((options.networkMethods ?? ["GET"]).map((entry) => entry.toUpperCase())).has(method))
        throw new GatewayHostPolicyError(`Network method ${method} is not allowed by the host adapter.`);
    const maxRequest = options.maxRequestBytes ?? 1_048_576;
    if (input.body !== undefined && Buffer.byteLength(input.body) > maxRequest)
        throw new GatewayOutputLimitError(`Network request body exceeded ${maxRequest} bytes.`);
    const pinned = await resolvePinnedAddress(url, options.networkAllowPrivateAddresses ?? false);
    const max = options.maxResponseBytes ?? 1_048_576;
    return new Promise((resolvePromise, rejectPromise) => {
        let settled = false;
        let bytes = 0;
        const chunks = [];
        const finishError = (error) => { if (settled)
            return; settled = true; rejectPromise(error); };
        const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest;
        const req = requestFn(url, {
            method,
            ...(input.headers ? { headers: input.headers } : {}),
            lookup: (_hostname, _lookupOptions, callback) => callback(null, pinned.address, pinned.family),
            ...(url.protocol === "https:" && isIP(url.hostname.replace(/^\[|\]$/g, "")) === 0 ? { servername: url.hostname } : {}),
        }, (response) => {
            response.on("data", (chunk) => { bytes += chunk.byteLength; if (bytes > max) {
                response.destroy();
                req.destroy();
                finishError(new GatewayOutputLimitError(`Network response exceeded ${max} bytes.`));
                return;
            } chunks.push(chunk); });
            response.on("error", (error) => finishError(new GatewayExecutionError(`Network response from ${url.origin} failed.`, { cause: error })));
            response.on("end", () => {
                if (settled)
                    return;
                settled = true;
                const headers = {};
                for (const [key, value] of Object.entries(response.headers ?? {}))
                    if (value !== undefined)
                        headers[key] = Array.isArray(value) ? value.join(", ") : String(value);
                resolvePromise(Object.freeze({ status: response.statusCode ?? 0, statusText: response.statusMessage ?? "", headers: Object.freeze(headers), body: Buffer.concat(chunks).toString("utf8"), url: url.href }));
            });
        });
        const onAbort = () => { req.destroy(); finishError(new GatewayExecutionError(`Network request to ${url.origin} was cancelled.`)); };
        context.signal.addEventListener("abort", onAbort, { once: true });
        req.on("error", (error) => { context.signal.removeEventListener("abort", onAbort); if (!settled)
            finishError(new GatewayExecutionError(`Network request to ${url.origin} failed.`, { cause: error })); });
        req.on("close", () => context.signal.removeEventListener("abort", onAbort));
        if (input.body !== undefined)
            req.write(input.body);
        req.end();
    });
}
/** Creates Node host adapters with a second, host-local fail-closed boundary. */
export async function createNodeGatewayAdapters(options) {
    const root = await realpath(resolve(options.fsRoot));
    const profiles = await resolveProcessProfiles(options.processProfiles, root);
    for (const [field, value] of [["maxProcessTimeoutMs", options.maxProcessTimeoutMs], ["maxOutputBytes", options.maxOutputBytes], ["processKillGraceMs", options.processKillGraceMs], ["maxFileReadBytes", options.maxFileReadBytes], ["maxFileWriteBytes", options.maxFileWriteBytes], ["maxRequestBytes", options.maxRequestBytes], ["maxResponseBytes", options.maxResponseBytes]])
        if (value !== undefined && (!Number.isFinite(value) || value <= 0))
            throw new GatewayHostPolicyError(`${field} must be a finite positive number.`);
    if (options.processCommands !== undefined && !options.processCommands.every((entry) => typeof entry === "string" && entry.length > 0))
        throw new GatewayHostPolicyError("processCommands must contain non-empty strings.");
    if (options.networkOrigins !== undefined && !options.networkOrigins.every((entry) => typeof entry === "string" && entry.length > 0))
        throw new GatewayHostPolicyError("networkOrigins must contain non-empty strings.");
    if (options.networkMethods !== undefined && !options.networkMethods.every((entry) => typeof entry === "string" && entry.trim().length > 0))
        throw new GatewayHostPolicyError("networkMethods must contain non-empty strings.");
    const filesystemSecurity = options.filesystemSecurity ?? "auto";
    const secureFilesystemAvailable = await secureLinuxFilesystemAvailable();
    if (filesystemSecurity === "required" && !secureFilesystemAvailable)
        throw new GatewayHostPolicyError("Descriptor-anchored secure filesystem mode is unavailable on this host.");
    const useSecureFilesystem = filesystemSecurity !== "legacy" && secureFilesystemAvailable;
    const safeOptions = Object.freeze({ ...options, ...(options.processCommands === undefined ? {} : { processCommands: Object.freeze([...options.processCommands]) }), ...(options.processEnvironment === undefined ? {} : { processEnvironment: Object.freeze({ ...options.processEnvironment }) }), ...(options.networkOrigins === undefined ? {} : { networkOrigins: Object.freeze([...options.networkOrigins]) }), ...(options.networkMethods === undefined ? {} : { networkMethods: Object.freeze([...options.networkMethods]) }) });
    const maxRead = options.maxFileReadBytes ?? 4_194_304;
    const maxWrite = options.maxFileWriteBytes ?? 4_194_304;
    return Object.freeze({
        "fs.read": async (input) => useSecureFilesystem ? secureReadFile(root, input.path, maxRead) : (() => scopedReadPath(root, input.path).then(async (path) => { const stat = await lstat(path); if (!stat.isFile())
            throw new GatewayHostPolicyError(`Read path ${input.path} is not a regular file.`); if (stat.size > maxRead)
            throw new GatewayOutputLimitError(`File ${input.path} exceeds ${maxRead} bytes.`); const data = await readFile(path, "utf8"); return Object.freeze({ data, bytes: Buffer.byteLength(data) }); }))(),
        "fs.write": async (input) => useSecureFilesystem ? secureWriteFile(root, input.path, input.data, maxWrite) : (() => { const bytes = Buffer.byteLength(input.data); if (bytes > maxWrite)
            throw new GatewayOutputLimitError(`File write ${input.path} exceeds ${maxWrite} bytes.`); return scopedWritePath(root, input.path).then(async (path) => { await writeFile(path, input.data, "utf8"); return Object.freeze({ bytesWritten: bytes }); }); })(),
        "process.exec": (input, context) => execProcess(input, context, safeOptions, root, profiles),
        "network.request": (input, context) => requestNetwork(input, context, safeOptions),
        "mcp.call": async (input, context) => { if (!safeOptions.mcpCall)
            throw new GatewayAdapterUnavailableError("No MCP host adapter is configured."); return safeOptions.mcpCall(input, context); },
        "browser.call": async (input, context) => { if (!safeOptions.browserCall)
            throw new GatewayAdapterUnavailableError("No browser host adapter is configured."); return safeOptions.browserCall(input, context); },
        "desktop.call": async (input, context) => { if (!safeOptions.desktopCall)
            throw new GatewayAdapterUnavailableError("No desktop host adapter is configured."); return safeOptions.desktopCall(input, context); },
    });
}
//# sourceMappingURL=node-adapters.js.map