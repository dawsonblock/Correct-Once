import test from "node:test";
import assert from "node:assert/strict";
import { createKernel } from "@function-hooks/core";
import { createStandardEventBlueprint, type StandardEvents } from "@function-hooks/events";
import { InMemoryActionReceiptStore, registerActionReceiptHooks, schema, EventSchemaRegistry } from "@function-hooks/assurance";
import { HashChainAuditLedger, registerHashChainAuditHooks } from "@function-hooks/audit";
import { ReplayLog, registerReplayHooks } from "@function-hooks/replay";
import { applyBlastDoor, registerOriginAllowlistHooks } from "@function-hooks/enterprise";
import { kernelIsolationPort } from "@function-hooks/isolation";

test("split packages compose above stable kernel without umbrella imports", async () => {
  const ledger=new HashChainAuditLedger(); const replay=new ReplayLog(); const receipts=new InMemoryActionReceiptStore();
  const builder=createKernel<StandardEvents>();
  const blueprint=applyBlastDoor(createStandardEventBlueprint({ toolCall: async (input)=>({ok:true,input}) }), new Set(["tool.call"]));
  builder.defineEngine(blueprint);
  registerOriginAllowlistHooks(builder,0,{"tool.call":["test"]});
  registerActionReceiptHooks(builder,10,receipts,{events:new Set(["tool.call"]), actionId:()=>"a1"});
  registerHashChainAuditHooks(builder,20,["tool.call"],ledger);
  registerReplayHooks(builder,30,["tool.call"],replay);
  const runtime=builder.build(); await runtime.start();
  const port=kernelIsolationPort(runtime);
  const result=await port.dispatch("tool.call",{tool:"Echo"},"test") as any;
  assert.equal(result.ok,true); assert.equal(ledger.entries().length,1); assert.equal(replay.records().length,1);
  await runtime.close();
});

test("assurance schema registry remains independent of compatibility runtime", () => {
  const registry=new EventSchemaRegistry(); registry.register({event:"x",version:"1.0.0",inputSchema:schema.string()});
  registry.validateInput("x","1.0.0","ok");
  assert.throws(()=>registry.validateInput("x","1.0.0",1));
});

import { createStandardKernel } from "@function-hooks/events";
import { FunctionHooksRuntime as CompatRuntime, registerCorePlugin as registerCompatCore } from "@function-hooks/compat";
import * as umbrella from "../src/index.js";

test("standard-kernel convenience path replaces legacy core bootstrap without engine.create", async () => {
  const builder = createStandardKernel({ promptSubmit: async ({ text }) => ({ normalized: text.trim() }) });
  builder.on("observer", 0, "prompt.submit", async (_engine, event, next) => next({ text: event.text.toUpperCase() }));
  const runtime = builder.build();
  await runtime.start();
  assert.deepEqual(await runtime.dispatch("prompt.submit", { text: "  hello  " }), { normalized: "HELLO" });
  await runtime.close();
});

test("umbrella root excludes legacy runtime while explicit compat package remains functional", async () => {
  assert.equal("FunctionHooksRuntime" in umbrella, false);
  assert.equal("registerCorePlugin" in umbrella, false);
  const runtime = new CompatRuntime();
  registerCompatCore(runtime, 100, { promptSubmit: async ({ text }) => ({ text: text.trim() }) });
  await runtime.start();
  assert.deepEqual(await runtime.dispatch("prompt.submit", { text: " compat " }), { text: "compat" });
});

import { createPortableKernel } from "@function-hooks/portable";
import { runKernelConformance } from "@function-hooks/core/conformance";

test("independent portable runtime passes the same published semantic contract", async () => {
  const report = await runKernelConformance(createPortableKernel);
  assert.equal(report.failed, 0, JSON.stringify(report, null, 2));
  assert.equal(report.total, 21);
});

test("portable runtime composes with the standard event blueprint", async () => {
  const builder = createPortableKernel<StandardEvents>();
  builder.defineEngine(createStandardEventBlueprint({ toolCall: async ({ tool }) => ({ runtime: "portable", tool }) }));
  builder.on("rewrite", 0, "tool.call", async (_engine, event, next) => next({ ...event, tool: `${event.tool}:rewritten` }));
  const runtime = builder.build(); await runtime.start();
  assert.deepEqual(await runtime.dispatch("tool.call", { tool: "Echo" }), { runtime: "portable", tool: "Echo:rewritten" });
  await runtime.close();
});
