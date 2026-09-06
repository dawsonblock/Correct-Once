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
export declare class HashChainAuditLedger {
    #private;
    constructor(options?: {
        readonly redact?: AuditRedactor;
        readonly hmacKey?: Uint8Array;
        readonly initialEntries?: readonly AuditLedgerEntry[];
    });
    append(payload: AuditPayload): AuditLedgerEntry;
    entries(): readonly AuditLedgerEntry[];
    verify(entries?: readonly AuditLedgerEntry[]): {
        readonly ok: true;
    } | {
        readonly ok: false;
        readonly index: number;
        readonly reason: string;
    };
}
export declare function redactKeys(keys: readonly string[]): AuditRedactor;
//# sourceMappingURL=ledger.d.ts.map