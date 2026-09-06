import type { HashChainAuditLedger } from "@function-hooks/audit";
import type { GatewayAuditSink } from "./types.js";

/** Maps gateway decision/execution records into the generic hash-chain ledger. */
export function gatewayHashChainAuditSink(ledger: HashChainAuditLedger): GatewayAuditSink {
  return (record) => {
    ledger.append({
      at: record.at,
      origin: record.origin,
      event: record.event,
      input: { phase: record.phase, actionId: record.actionId, input: record.input, ...(record.reason ? { reason: record.reason } : {}) },
      ...(record.result === undefined ? {} : { result: record.result }),
      ...(record.error === undefined ? {} : { error: record.error }),
    });
  };
}
