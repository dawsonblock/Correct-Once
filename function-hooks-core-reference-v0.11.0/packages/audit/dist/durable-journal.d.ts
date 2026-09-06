import { HashChainAuditLedger, type AuditLedgerEntry, type AuditPayload, type AuditRedactor } from "./ledger.js";
export interface DurableAuditJournalOptions {
    readonly hmacKey?: Uint8Array;
    readonly redact?: AuditRedactor;
    readonly sync?: "always" | "none";
    /** If true, discard a final unterminated JSON fragment after a crash. */
    readonly recoverTrailingPartial?: boolean;
    /** Cross-process coordination using a crash-recoverable exclusive lock file. Defaults to true. */
    readonly crossProcessLock?: boolean;
    readonly lockTimeoutMs?: number;
    readonly lockStaleMs?: number;
}
export declare class DurableAuditJournal {
    #private;
    private constructor();
    static open(path: string, options?: DurableAuditJournalOptions): Promise<DurableAuditJournal>;
    /** Refreshes this instance from durable state under the cross-process lock. */
    refresh(): Promise<readonly AuditLedgerEntry[]>;
    entries(): readonly AuditLedgerEntry[];
    verify(): ReturnType<HashChainAuditLedger["verify"]>;
    append(payload: AuditPayload): Promise<AuditLedgerEntry>;
    path(): string;
}
export declare function verifyDurableAuditJournal(path: string, options?: DurableAuditJournalOptions): Promise<{
    readonly ok: true;
    readonly entries: number;
}>;
//# sourceMappingURL=durable-journal.d.ts.map