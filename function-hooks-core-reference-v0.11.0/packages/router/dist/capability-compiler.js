import { assertAdmittedCapability } from "@function-hooks/capabilities";
import { InvalidCapabilityRouteError } from "./errors.js";
import { createExecutionRouter } from "./router.js";
const META_ID = "function-hooks.capability.id";
const META_CANDIDATE = "function-hooks.capability.candidate-hash";
const META_DESCRIPTOR = "function-hooks.capability.descriptor-hash";
const META_ADMISSION = "function-hooks.capability.admission-id";
const META_POLICY = "function-hooks.capability.policy-version";
function inputObject(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new InvalidCapabilityRouteError(`${label} requires an object input.`);
    return value;
}
function stringField(value, field) {
    if (typeof value !== "string" || value.length === 0)
        throw new InvalidCapabilityRouteError(`${field} must be a non-empty string.`);
    return value;
}
function textField(value, field) {
    if (typeof value !== "string")
        throw new InvalidCapabilityRouteError(`${field} must be a string.`);
    return value;
}
function stringArray(value, field) {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
        throw new InvalidCapabilityRouteError(`${field} must be an array of strings.`);
    return Object.freeze([...value]);
}
function trustedMetadata(capability) {
    return Object.freeze({
        [META_ID]: capability.id,
        [META_CANDIDATE]: capability.candidateHash,
        [META_DESCRIPTOR]: capability.descriptorHash,
        [META_ADMISSION]: capability.admission.admissionId,
        [META_POLICY]: capability.admission.policyVersion,
    });
}
export function compileAdmittedCapabilityRoute(value) {
    assertAdmittedCapability(value);
    const capability = value;
    const common = { app: capability.app, capability: capability.capability, trustedMetadata: trustedMetadata(capability) };
    const implementation = capability.implementation;
    if (implementation.kind === "mcp") {
        return Object.freeze({ ...common, backend: "mcp", event: "mcp.call",
            build: (request) => ({ server: implementation.server, tool: implementation.tool, ...(request.input === undefined ? {} : { args: request.input }) }) });
    }
    if (implementation.kind === "http") {
        return Object.freeze({ ...common, backend: "api", event: "network.request",
            build: (request) => {
                const bodyMode = implementation.body ?? "json";
                let body;
                if (bodyMode === "text" && request.input !== undefined)
                    body = textField(request.input, "request.input");
                if (bodyMode === "json" && request.input !== undefined)
                    body = JSON.stringify(request.input);
                const headers = { ...(implementation.headers ?? {}) };
                if (bodyMode === "json" && body !== undefined && !Object.keys(headers).some((key) => key.toLowerCase() === "content-type"))
                    headers["content-type"] = "application/json";
                return { url: implementation.url, ...(implementation.method === undefined ? {} : { method: implementation.method }), ...(Object.keys(headers).length ? { headers } : {}), ...(body === undefined ? {} : { body }) };
            } });
    }
    if (implementation.kind === "browser") {
        return Object.freeze({ ...common, backend: "browser", event: "browser.call",
            build: (request) => ({ operation: implementation.operation, ...(implementation.target === undefined ? {} : { target: implementation.target }), ...(request.input === undefined ? {} : { args: request.input }) }) });
    }
    if (implementation.kind === "desktop") {
        return Object.freeze({ ...common, backend: "desktop", event: "desktop.call",
            build: (request) => ({ application: implementation.application, operation: implementation.operation, ...(implementation.target === undefined ? {} : { target: implementation.target }), ...(request.input === undefined ? {} : { args: request.input }) }) });
    }
    if (implementation.kind === "process") {
        return Object.freeze({ ...common, backend: "local", event: "process.exec",
            build: (request) => ({ profile: implementation.profile, ...(request.input === undefined ? {} : { args: stringArray(request.input, "request.input") }), ...(implementation.cwd === undefined ? {} : { cwd: implementation.cwd }), ...(implementation.timeoutMs === undefined ? {} : { timeoutMs: implementation.timeoutMs }) }) });
    }
    if (implementation.kind === "filesystem.read") {
        return Object.freeze({ ...common, backend: "local", event: "fs.read",
            build: (request) => {
                const path = implementation.path ?? (typeof request.input === "string" ? request.input : stringField(inputObject(request.input, "filesystem.read input").path, "request.input.path"));
                return { path };
            } });
    }
    if (implementation.kind === "filesystem.write") {
        return Object.freeze({ ...common, backend: "local", event: "fs.write",
            build: (request) => {
                const input = inputObject(request.input, "filesystem.write input");
                const path = implementation.path ?? stringField(input.path, "request.input.path");
                const data = textField(input.data, "request.input.data");
                return { path, data };
            } });
    }
    throw new InvalidCapabilityRouteError(`Capability ${capability.id} has unsupported implementation.`);
}
export async function compileActiveCapabilityRoutes(registry) {
    const records = await registry.list({ state: "active" });
    return Object.freeze(records.map(({ capability }) => compileAdmittedCapabilityRoute(capability)));
}
export async function createExecutionRouterFromRegistry(options) {
    const generated = await compileActiveCapabilityRoutes(options.registry);
    return createExecutionRouter({ gateway: options.gateway, routes: [...generated, ...(options.manualRoutes ?? [])] });
}
//# sourceMappingURL=capability-compiler.js.map