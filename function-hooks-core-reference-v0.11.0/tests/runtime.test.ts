import test from "node:test";
import assert from "node:assert/strict";
import { FunctionHooksRuntime, addEvents, registerCorePlugin, substructuralMatch } from "@function-hooks/compat";
import { registerBlastDoorPlugin } from "@function-hooks/enterprise";

function core(runtime: FunctionHooksRuntime, order = 99): void {
  registerCorePlugin(runtime, order, {
    toolCall: async (input) => ({ ok: true, value: input }),
    uiLog: async () => undefined,
    promptSubmit: async (input) => input,
  });
}

test("before/after nesting follows registration order", async () => {
  const runtime = new FunctionHooksRuntime();
  const log: string[] = [];
  const a = runtime.registrar("a", 0);
  a("tool.call", async (_$, e, next) => {
    log.push("a-before");
    const result = await next(e);
    log.push("a-after");
    return result;
  });
  const b = runtime.registrar("b", 1);
  b("tool.call", async (_$, e, next) => {
    log.push("b-before");
    const result = await next(e);
    log.push("b-after");
    return result;
  });
  core(runtime);
  const $ = await runtime.start();
  await $.tool!.call!({ tool: "Echo" });
  assert.deepEqual(log, ["a-before", "b-before", "b-after", "a-after"]);
});

test("instead placement bypasses everything below", async () => {
  const runtime = new FunctionHooksRuntime();
  let baseCalled = false;
  const p = runtime.registrar("deny", 0);
  p("tool.call", async () => ({ deny: "no tools" }));
  registerCorePlugin(runtime, 99, {
    toolCall: async () => { baseCalled = true; return { ok: true }; },
  });
  const $ = await runtime.start();
  const result = await $.tool!.call!({ tool: "Echo" });
  assert.deepEqual(result, { deny: "no tools" });
  assert.equal(baseCalled, false);
});

test("modifying placement forwards immutable copy", async () => {
  const runtime = new FunctionHooksRuntime();
  const p = runtime.registrar("timeout", 0);
  p("tool.call", async (_$, e: any, next: any) => {
    assert.equal(Object.isFrozen(e), true);
    return next({ ...e, timeout: 30 });
  });
  registerCorePlugin(runtime, 99, { toolCall: async (input) => input });
  const $ = await runtime.start();
  const result = await $.tool!.call!({ tool: "Echo", timeout: 5 }) as any;
  assert.equal(result.timeout, 30);
});

test("matcher supports partial objects, array-any, and empty-array-never", () => {
  assert.equal(substructuralMatch({ surface: ["terminal", "desktop"] }, { surface: "desktop", x: 1 }), true);
  assert.equal(substructuralMatch({ surface: [] }, { surface: "desktop" }), false);
  assert.equal(substructuralMatch({ nested: { a: 1 } }, { nested: { a: 1, b: 2 } }), true);
});

test("matchers are evaluated against rewritten event for downstream hooks", async () => {
  const runtime = new FunctionHooksRuntime();
  let matched = false;
  const a = runtime.registrar("rewrite", 0);
  a("tool.call", async (_$, e: any, next: any) => next({ ...e, tool: "Bash" }));
  const b = runtime.registrar("bash", 1);
  b("tool.call", { tool: "Bash" }, async (_$, e, next) => { matched = true; return next(e); });
  core(runtime);
  const $ = await runtime.start();
  await $.tool!.call!({ tool: "Other" });
  assert.equal(matched, true);
});

test("a pure event may call next more than once within its declared budget", async () => {
  const runtime = new FunctionHooksRuntime();
  let baseCount = 0;
  const p = runtime.registrar("fanout", 0);
  p("pure.echo", async (_$, e: any, next: any) => {
    const first = await next({ ...e, value: 1 });
    const second = await next({ ...e, value: 2 });
    return [first, second];
  });
  const base = runtime.registrar("pure-base", 99);
  base("engine.create", async (_$, event, next) => {
    const below = await next(event);
    return addEvents(below, "pure-base", {
      "pure.echo": {
        behavior: { sideEffect: false, idempotent: true, maxNextCalls: 4 },
        invoke: async (input) => { baseCount += 1; return input; },
      },
    });
  });
  const $ = await runtime.start();
  const result = await $.pure!.echo!({ value: 0 }) as any[];
  assert.equal(baseCount, 2);
  assert.equal((result[0] as any).value, 1);
  assert.equal((result[1] as any).value, 2);
});

test("recursive dispatch skips the hook that raised it but preserves other hooks", async () => {
  const runtime = new FunctionHooksRuntime();
  let recursiveHookCount = 0;
  let auditCount = 0;

  const audit = runtime.registrar("audit", 0);
  audit("*", async (_$, e, next) => { auditCount += 1; return next(e); });

  const recursive = runtime.registrar("recursive", 1);
  recursive("prompt.submit", async ($, e: any, next: any) => {
    recursiveHookCount += 1;
    if (e.text === "outer") await $.prompt!.submit!({ text: "inner" });
    return next(e);
  });

  core(runtime);
  const $ = await runtime.start();
  await $.prompt!.submit!({ text: "outer" });
  assert.equal(recursiveHookCount, 1);
  assert.equal(auditCount, 2);
});

test("engine.create lets plugins add events without replacing existing definitions", async () => {
  const runtime = new FunctionHooksRuntime();
  const custom = runtime.registrar("cache", 0);
  custom("engine.create", async (_$, event, next) => {
    const below = await next(event);
    return addEvents(below, "cache", {
      "cache.get": async (input: any) => `value:${input.key}`,
    });
  });
  core(runtime);
  const $ = await runtime.start();
  assert.equal(await $.cache!.get!({ key: "x" }), "value:x");
});

test("blast door can withhold engine nouns/events", async () => {
  const runtime = new FunctionHooksRuntime();
  registerBlastDoorPlugin(runtime, 0, new Set(["ui.log", "tool.call"]));
  core(runtime, 99);
  const $ = await runtime.start();
  assert.ok($.tool);
  assert.ok($.ui);
  assert.equal($.fs, undefined);
});

test("next metadata exposes event and origin", async () => {
  const runtime = new FunctionHooksRuntime();
  let seen: any;
  const p = runtime.registrar("observer", 0);
  p("tool.call", async (_$, e, next: any) => {
    seen = { event: next.event, origin: next.origin, is: next.is("tool.call", e), frozen: Object.isFrozen(next) };
    return next(e);
  });
  core(runtime);
  const $ = await runtime.start();
  await $.tool!.call!({ tool: "X" });
  assert.deepEqual(seen, { event: "tool.call", origin: "engine", is: true, frozen: true });
});
