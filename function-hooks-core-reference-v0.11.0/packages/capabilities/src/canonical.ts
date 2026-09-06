import { createHash } from "node:crypto";
import { InvalidCapabilityError } from "./errors.js";

function normalize(value: unknown, seen: Set<object>, path: string): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new InvalidCapabilityError(`${path} contains NaN or Infinity.`);
    return value;
  }
  if (value === undefined) return undefined;
  if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") {
    throw new InvalidCapabilityError(`${path} contains unsupported ${typeof value}.`);
  }
  if (Array.isArray(value)) return value.map((entry, index) => normalize(entry, seen, `${path}[${index}]`));
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new InvalidCapabilityError(`${path} must contain only plain objects and arrays.`);
    if (seen.has(value)) throw new InvalidCapabilityError(`${path} contains a cycle.`);
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = normalize((value as Record<string, unknown>)[key], seen, `${path}.${key}`);
      if (entry !== undefined) out[key] = entry;
    }
    seen.delete(value);
    return out;
  }
  throw new InvalidCapabilityError(`${path} contains an unsupported value.`);
}

export function canonicalCapabilityJson(value: unknown): string {
  return JSON.stringify(normalize(value, new Set<object>(), "capability"));
}
export function capabilitySha256(value: unknown): string {
  return createHash("sha256").update(canonicalCapabilityJson(value)).digest("hex");
}
export function capabilitySnapshot<T>(value: T): T {
  const normalized = normalize(value, new Set<object>(), "capability") as T;
  return deepFreeze(normalized);
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
