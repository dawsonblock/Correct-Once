import { createHash } from "node:crypto";
import { InvalidCapabilityError } from "./errors.js";
function normalize(value, seen, path) {
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return value;
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            throw new InvalidCapabilityError(`${path} contains NaN or Infinity.`);
        return value;
    }
    if (value === undefined)
        return undefined;
    if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") {
        throw new InvalidCapabilityError(`${path} contains unsupported ${typeof value}.`);
    }
    if (Array.isArray(value))
        return value.map((entry, index) => normalize(entry, seen, `${path}[${index}]`));
    if (typeof value === "object") {
        const proto = Object.getPrototypeOf(value);
        if (proto !== Object.prototype && proto !== null)
            throw new InvalidCapabilityError(`${path} must contain only plain objects and arrays.`);
        if (seen.has(value))
            throw new InvalidCapabilityError(`${path} contains a cycle.`);
        seen.add(value);
        const out = {};
        for (const key of Object.keys(value).sort()) {
            const entry = normalize(value[key], seen, `${path}.${key}`);
            if (entry !== undefined)
                out[key] = entry;
        }
        seen.delete(value);
        return out;
    }
    throw new InvalidCapabilityError(`${path} contains an unsupported value.`);
}
export function canonicalCapabilityJson(value) {
    return JSON.stringify(normalize(value, new Set(), "capability"));
}
export function capabilitySha256(value) {
    return createHash("sha256").update(canonicalCapabilityJson(value)).digest("hex");
}
export function capabilitySnapshot(value) {
    const normalized = normalize(value, new Set(), "capability");
    return deepFreeze(normalized);
}
function deepFreeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
        for (const child of Object.values(value))
            deepFreeze(child);
        Object.freeze(value);
    }
    return value;
}
//# sourceMappingURL=canonical.js.map