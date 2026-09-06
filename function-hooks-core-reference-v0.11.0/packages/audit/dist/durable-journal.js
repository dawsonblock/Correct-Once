import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { AuditRecoveryError } from "./errors.js";
import { HashChainAuditLedger, } from "./ledger.js";
import { withFileLock } from "./file-lock.js";
function parseJournal(raw, recoverTrailingPartial) {
    if (!raw)
        return { entries: [], normalized: "", repaired: false };
    let normalized = raw;
    let repaired = false;
    if (!raw.endsWith("\n")) {
        if (!recoverTrailingPartial)
            throw new AuditRecoveryError("Audit journal ends with an unterminated record.");
        const lastNewline = raw.lastIndexOf("\n");
        normalized = lastNewline < 0 ? "" : raw.slice(0, lastNewline + 1);
        repaired = normalized !== raw;
    }
    const entries = [];
    for (const [index, line] of normalized.split("\n").entries()) {
        if (!line.trim())
            continue;
        try {
            entries.push(JSON.parse(line));
        }
        catch (error) {
            throw new AuditRecoveryError(`Audit journal record ${index} is invalid JSON.`, { cause: error });
        }
    }
    return { entries, normalized, repaired };
}
export class DurableAuditJournal {
    #path;
    #options;
    #ledger;
    #appendQueue = Promise.resolve();
    #persistenceFailure;
    constructor(path, ledger, options) {
        this.#path = path;
        this.#ledger = ledger;
        this.#options = options;
    }
    static async open(path, options = {}) {
        await mkdir(dirname(path), { recursive: true });
        return withFileLock(path, { enabled: options.crossProcessLock ?? true, ...(options.lockTimeoutMs === undefined ? {} : { timeoutMs: options.lockTimeoutMs }), ...(options.lockStaleMs === undefined ? {} : { staleMs: options.lockStaleMs }) }, async () => {
            let raw = "";
            try {
                raw = await readFile(path, "utf8");
            }
            catch (error) {
                if (error?.code !== "ENOENT")
                    throw error;
                await writeFile(path, "", "utf8");
            }
            const parsed = parseJournal(raw, options.recoverTrailingPartial ?? false);
            const ledger = new HashChainAuditLedger({
                ...(options.hmacKey ? { hmacKey: options.hmacKey } : {}),
                ...(options.redact ? { redact: options.redact } : {}),
                initialEntries: parsed.entries,
            });
            const check = ledger.verify();
            if (!check.ok)
                throw new AuditRecoveryError(`Audit chain verification failed at index ${check.index}: ${check.reason}`);
            if (parsed.repaired)
                await writeFile(path, parsed.normalized, "utf8");
            return new DurableAuditJournal(path, ledger, options);
        });
    }
    async #reloadFromDisk() {
        const raw = await readFile(this.#path, "utf8");
        const parsed = parseJournal(raw, this.#options.recoverTrailingPartial ?? false);
        const ledger = new HashChainAuditLedger({
            ...(this.#options.hmacKey ? { hmacKey: this.#options.hmacKey } : {}),
            ...(this.#options.redact ? { redact: this.#options.redact } : {}),
            initialEntries: parsed.entries,
        });
        const check = ledger.verify();
        if (!check.ok)
            throw new AuditRecoveryError(`Audit chain verification failed at index ${check.index}: ${check.reason}`);
        if (parsed.repaired)
            await writeFile(this.#path, parsed.normalized, "utf8");
        this.#ledger = ledger;
    }
    /** Refreshes this instance from durable state under the cross-process lock. */
    async refresh() {
        return withFileLock(this.#path, { enabled: this.#options.crossProcessLock ?? true, ...(this.#options.lockTimeoutMs === undefined ? {} : { timeoutMs: this.#options.lockTimeoutMs }), ...(this.#options.lockStaleMs === undefined ? {} : { staleMs: this.#options.lockStaleMs }) }, async () => {
            await this.#reloadFromDisk();
            return this.#ledger.entries();
        });
    }
    entries() { return this.#ledger.entries(); }
    verify() { return this.#ledger.verify(); }
    async append(payload) {
        let resolveEntry;
        let rejectEntry;
        const result = new Promise((resolve, reject) => { resolveEntry = resolve; rejectEntry = reject; });
        const task = this.#appendQueue.then(async () => {
            if (this.#persistenceFailure)
                throw new AuditRecoveryError("Audit journal is unavailable after a persistence failure; reopen and recover before continuing.", { cause: this.#persistenceFailure });
            await withFileLock(this.#path, { enabled: this.#options.crossProcessLock ?? true, ...(this.#options.lockTimeoutMs === undefined ? {} : { timeoutMs: this.#options.lockTimeoutMs }), ...(this.#options.lockStaleMs === undefined ? {} : { staleMs: this.#options.lockStaleMs }) }, async () => {
                // Reload the durable head while holding the inter-process lock. This prevents
                // separately opened journal instances/processes from forking the hash chain.
                await this.#reloadFromDisk();
                const candidate = new HashChainAuditLedger({
                    ...(this.#options.hmacKey ? { hmacKey: this.#options.hmacKey } : {}),
                    ...(this.#options.redact ? { redact: this.#options.redact } : {}),
                    initialEntries: this.#ledger.entries(),
                });
                const entry = candidate.append(payload);
                try {
                    const handle = await open(this.#path, "a");
                    try {
                        await handle.write(`${JSON.stringify(entry)}\n`);
                        if ((this.#options.sync ?? "always") === "always")
                            await handle.sync();
                    }
                    finally {
                        await handle.close();
                    }
                }
                catch (error) {
                    this.#persistenceFailure = error instanceof Error ? error : new Error(String(error));
                    throw error;
                }
                this.#ledger = candidate;
                resolveEntry(entry);
            });
        });
        this.#appendQueue = task.catch((error) => { rejectEntry(error); });
        await this.#appendQueue;
        return result;
    }
    path() { return this.#path; }
}
export async function verifyDurableAuditJournal(path, options = {}) {
    const journal = await DurableAuditJournal.open(path, { ...options, recoverTrailingPartial: false });
    const check = journal.verify();
    if (!check.ok)
        throw new AuditRecoveryError(`Audit verification failed at index ${check.index}: ${check.reason}`);
    return { ok: true, entries: journal.entries().length };
}
//# sourceMappingURL=durable-journal.js.map