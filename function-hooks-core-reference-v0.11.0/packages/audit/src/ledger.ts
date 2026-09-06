import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalJson, sha256Hex } from "@function-hooks/assurance";

export interface AuditPayload {
  readonly at: number;
  readonly origin: string;
  readonly event: string;
  readonly input: unknown;
  readonly result?: unknown;
  readonly error?: string;
}

export interface AuditLedgerEntry {
  readonly sequence: number;
  readonly previousHash: string;
  readonly payload: AuditPayload;
  readonly payloadHash: string;
  readonly entryHash: string;
  readonly mac?: string;
}

export type AuditRedactor = (payload: AuditPayload) => AuditPayload;

export class HashChainAuditLedger {
  readonly #entries: AuditLedgerEntry[] = [];
  readonly #redact: AuditRedactor;
  readonly #hmacKey: Uint8Array | undefined;

  constructor(options: { readonly redact?: AuditRedactor; readonly hmacKey?: Uint8Array; readonly initialEntries?: readonly AuditLedgerEntry[] } = {}) {
    this.#redact = options.redact ?? ((payload) => payload);
    this.#hmacKey = options.hmacKey;
    if (options.initialEntries?.length) {
      const checked = this.verify(options.initialEntries);
      if (!checked.ok) throw new Error(`Invalid initial audit chain at index ${checked.index}: ${checked.reason}`);
      this.#entries.push(...options.initialEntries.map((entry) => Object.freeze({ ...entry })));
    }
  }

  append(payload: AuditPayload): AuditLedgerEntry {
    const safe = this.#redact(payload);
    const sequence = this.#entries.length;
    const previousHash = sequence === 0 ? "0".repeat(64) : this.#entries[sequence - 1]!.entryHash;
    const payloadHash = sha256Hex(canonicalJson(safe));
    const entryHash = sha256Hex(canonicalJson({ sequence, previousHash, payloadHash }));
    const mac = this.#hmacKey ? createHmac("sha256", this.#hmacKey).update(entryHash).digest("hex") : undefined;
    const entry = Object.freeze({ sequence, previousHash, payload: safe, payloadHash, entryHash, ...(mac ? { mac } : {}) });
    this.#entries.push(entry);
    return entry;
  }

  entries(): readonly AuditLedgerEntry[] {
    return Object.freeze([...this.#entries]);
  }

  verify(entries: readonly AuditLedgerEntry[] = this.#entries): { readonly ok: true } | { readonly ok: false; readonly index: number; readonly reason: string } {
    let previousHash = "0".repeat(64);
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]!;
      if (entry.sequence !== index) return { ok: false, index, reason: "sequence mismatch" };
      if (entry.previousHash !== previousHash) return { ok: false, index, reason: "previous hash mismatch" };
      const payloadHash = sha256Hex(canonicalJson(entry.payload));
      if (entry.payloadHash !== payloadHash) return { ok: false, index, reason: "payload hash mismatch" };
      const entryHash = sha256Hex(canonicalJson({ sequence: entry.sequence, previousHash: entry.previousHash, payloadHash: entry.payloadHash }));
      if (entry.entryHash !== entryHash) return { ok: false, index, reason: "entry hash mismatch" };
      if (this.#hmacKey) {
        if (!entry.mac) return { ok: false, index, reason: "missing MAC" };
        const expected = createHmac("sha256", this.#hmacKey).update(entry.entryHash).digest();
        const actual = Buffer.from(entry.mac, "hex");
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return { ok: false, index, reason: "MAC mismatch" };
      }
      previousHash = entry.entryHash;
    }
    return { ok: true };
  }
}

export function redactKeys(keys: readonly string[]): AuditRedactor {
  const denied = new Set(keys);
  const scrub = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) out[key] = denied.has(key) ? "[REDACTED]" : scrub(entry);
      return out;
    }
    return value;
  };
  return (payload) => ({ ...payload, input: scrub(payload.input), ...(payload.result === undefined ? {} : { result: scrub(payload.result) }) });
}
