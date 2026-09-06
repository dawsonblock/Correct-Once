import { createKernel } from "@function-hooks/core";
import { createStandardEventBlueprint } from "@function-hooks/events";
import { registerActionReceiptHooks, InMemoryActionReceiptStore } from "@function-hooks/assurance";
import { HashChainAuditLedger, registerHashChainAuditHooks } from "@function-hooks/audit";
import { ReplayLog, registerReplayHooks } from "@function-hooks/replay";
import { registerOriginAllowlistHooks } from "@function-hooks/enterprise";
const ledger = new HashChainAuditLedger();
const replay = new ReplayLog();
const receipts = new InMemoryActionReceiptStore();
const builder = createKernel();
builder.defineEngine(createStandardEventBlueprint({ toolCall: async (input) => ({ ok: true, input }) }));
registerOriginAllowlistHooks(builder, 0, { "tool.call": ["demo"] });
registerActionReceiptHooks(builder, 10, receipts, { events: new Set(["tool.call"]), actionId: (_event, input) => String(input?.args?.actionId ?? "") });
registerHashChainAuditHooks(builder, 20, ["tool.call"], ledger);
registerReplayHooks(builder, 30, ["tool.call"], replay);
const runtime = builder.build();
await runtime.start();
const result = await runtime.dispatch("tool.call", { tool: "Echo", args: { actionId: "demo-1" } }, { origin: "demo" });
if (result?.ok !== true || ledger.entries().length !== 1 || replay.records().length !== 1)
    throw new Error("split demo failed");
await runtime.close();
console.log("split package kernel demo: PASS");
//# sourceMappingURL=split-kernel-demo.js.map