import { createHash } from "node:crypto";

function normalize(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON does not permit NaN or Infinity.");
    return value;
  }
  if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function" || value === undefined) {
    throw new TypeError(`Unsupported canonical JSON value: ${typeof value}`);
  }
  if (Array.isArray(value)) return value.map((entry) => normalize(entry, seen));
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      const name = proto?.constructor?.name ?? "unknown";
      throw new TypeError(`Canonical JSON permits only arrays and plain objects; received ${name}.`);
    }
    if (seen.has(value)) throw new TypeError("Canonical JSON does not permit cycles.");
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) out[key] = normalize(entry, seen);
    }
    seen.delete(value);
    return out;
  }
  throw new TypeError("Unsupported canonical JSON value.");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value, new Set<object>()));
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalSha256(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export function serializedBytes(value: unknown): number {
  if (value === undefined) return 0;
  return Buffer.byteLength(canonicalJson(value), "utf8");
}
