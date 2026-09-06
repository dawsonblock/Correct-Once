import test from "node:test";
import assert from "node:assert/strict";
import { runKernelConformance } from "@function-hooks/core/conformance";
import { createPortableKernel } from "../src/index.js";

test("portable runtime passes the published kernel conformance contract", async () => {
  const report = await runKernelConformance(createPortableKernel);
  assert.equal(report.failed, 0, JSON.stringify(report, null, 2));
  assert.equal(report.passed, report.total);
});

test("portable trace observer failures are isolated from dispatch semantics", async () => {
  type Events = { "math.add": { input: { readonly a: number; readonly b: number }; result: number } };
  let calls = 0;
  const builder = createPortableKernel<Events>({ trace: () => { calls += 1; throw new Error("observer failed"); } });
  builder.defineEngine({ events: new Map([["math.add", { invoke: (input) => input.a + input.b }]]) });
  const runtime = builder.build();
  await runtime.start();
  assert.equal(await runtime.dispatch("math.add", { a: 2, b: 4 }), 6);
  assert.equal(calls > 0, true);
  await runtime.close();
});
