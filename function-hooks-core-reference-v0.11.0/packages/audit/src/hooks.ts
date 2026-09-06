import type { EventMap, EventName, KernelBuilder } from "@function-hooks/core";
import type { HashChainAuditLedger } from "./ledger.js";

export interface AuditRecord { readonly origin: string; readonly event: string; readonly at: number; readonly input: unknown; readonly result?: unknown; readonly error?: string; }
export type AuditSink = (record: AuditRecord) => void | Promise<void>;

/** Stable-kernel audit adapter. Wildcards remain outside core, so event names are explicit. */
export function registerAuditHooks<M extends EventMap>(builder: KernelBuilder<M>, pluginOrder: number, events: readonly EventName<M>[], sink: AuditSink): void {
  for (const event of events) {
    builder.on("audit", pluginOrder, event, async (_engine, input, next) => {
      const at = Date.now();
      try {
        const result = await next(input as never);
        await sink({ origin: next.origin, event: String(next.event), at, input, ...(result === undefined ? {} : { result }) });
        return result;
      } catch (error) {
        await sink({ origin: next.origin, event: String(next.event), at, input, error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    });
  }
}
export function registerHashChainAuditHooks<M extends EventMap>(builder: KernelBuilder<M>, pluginOrder: number, events: readonly EventName<M>[], ledger: HashChainAuditLedger): void {
  registerAuditHooks(builder, pluginOrder, events, (record) => { ledger.append(record); });
}
