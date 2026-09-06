import type { EventMap, EventName, KernelBuilder } from "@function-hooks/core";
import type { HashChainAuditLedger } from "./ledger.js";
export interface AuditRecord {
    readonly origin: string;
    readonly event: string;
    readonly at: number;
    readonly input: unknown;
    readonly result?: unknown;
    readonly error?: string;
}
export type AuditSink = (record: AuditRecord) => void | Promise<void>;
/** Stable-kernel audit adapter. Wildcards remain outside core, so event names are explicit. */
export declare function registerAuditHooks<M extends EventMap>(builder: KernelBuilder<M>, pluginOrder: number, events: readonly EventName<M>[], sink: AuditSink): void;
export declare function registerHashChainAuditHooks<M extends EventMap>(builder: KernelBuilder<M>, pluginOrder: number, events: readonly EventName<M>[], ledger: HashChainAuditLedger): void;
//# sourceMappingURL=hooks.d.ts.map