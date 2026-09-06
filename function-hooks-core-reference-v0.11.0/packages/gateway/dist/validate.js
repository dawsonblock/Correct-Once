import { GatewayInvalidActionError } from "./errors.js";
function object(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new GatewayInvalidActionError("Gateway action input must be an object.");
    return value;
}
function nonEmpty(value, field) {
    if (typeof value !== "string" || value.trim().length === 0)
        throw new GatewayInvalidActionError(`${field} must be a non-empty string.`);
    return value;
}
function optionalStringRecord(value, field) {
    if (value === undefined)
        return;
    const record = object(value);
    for (const [key, entry] of Object.entries(record)) {
        nonEmpty(key, `${field} key`);
        if (typeof entry !== "string")
            throw new GatewayInvalidActionError(`${field}.${key} must be a string.`);
    }
}
export function validateGatewayInput(event, input) {
    const record = object(input);
    nonEmpty(record.actionId, "actionId");
    optionalStringRecord(record.metadata, "metadata");
    switch (event) {
        case "mcp.call":
            nonEmpty(record.server, "server");
            nonEmpty(record.tool, "tool");
            break;
        case "browser.call":
            nonEmpty(record.operation, "operation");
            if (record.target !== undefined)
                nonEmpty(record.target, "target");
            break;
        case "desktop.call":
            nonEmpty(record.application, "application");
            nonEmpty(record.operation, "operation");
            if (record.target !== undefined)
                nonEmpty(record.target, "target");
            break;
        case "fs.read":
            nonEmpty(record.path, "path");
            break;
        case "fs.write":
            nonEmpty(record.path, "path");
            if (typeof record.data !== "string")
                throw new GatewayInvalidActionError("data must be a string.");
            break;
        case "process.exec": {
            const hasProfile = record.profile !== undefined;
            const hasCommand = record.command !== undefined;
            if (hasProfile === hasCommand)
                throw new GatewayInvalidActionError("process.exec must specify exactly one of profile or command.");
            if (hasProfile)
                nonEmpty(record.profile, "profile");
            if (hasCommand)
                nonEmpty(record.command, "command");
            if (record.args !== undefined && (!Array.isArray(record.args) || !record.args.every((entry) => typeof entry === "string")))
                throw new GatewayInvalidActionError("args must be an array of strings.");
            if (record.cwd !== undefined)
                nonEmpty(record.cwd, "cwd");
            if (record.timeoutMs !== undefined && (typeof record.timeoutMs !== "number" || !Number.isFinite(record.timeoutMs) || record.timeoutMs <= 0))
                throw new GatewayInvalidActionError("timeoutMs must be a finite positive number.");
            break;
        }
        case "network.request":
            nonEmpty(record.url, "url");
            if (record.method !== undefined)
                nonEmpty(record.method, "method");
            optionalStringRecord(record.headers, "headers");
            if (record.body !== undefined && typeof record.body !== "string")
                throw new GatewayInvalidActionError("body must be a string.");
            break;
    }
}
//# sourceMappingURL=validate.js.map