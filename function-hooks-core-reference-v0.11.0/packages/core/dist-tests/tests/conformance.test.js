import assert from "node:assert/strict";
import test from "node:test";
import { THREE_HOOK_GOLDEN_TRACE } from "../src/conformance.js";
import { BaseExecutionError, DispatchCancelledError, DispatchTimeoutError, HookExecutionError, NextMultiplicityError, RuntimeClosedError, RuntimeStateError, UnknownEventError, UnsupportedEventValueError, createBlueprint, createKernel, } from "../src/index.js";
function baseBlueprint() {
    return createBlueprint({
        "math.add": { invoke: ({ a, b }) => a + b },
        "log.write": { invoke: () => undefined },
    });
}
test("ordering wraps lower numeric order around higher order and preserves ties", async () => {
    const seen = [];
    const builder = createKernel();
    builder.defineEngine(baseBlueprint());
    builder.on("a", 10, "math.add", async (_engine, event, next) => {
        seen.push("a:before");
        const value = await next(event);
        seen.push("a:after");
        return value;
    });
    builder.on("b", 10, "math.add", async (_engine, event, next) => {
        seen.push("b:before");
        const value = await next(event);
        seen.push("b:after");
        return value;
    });
    builder.on("c", 20, "math.add", async (_engine, event, next) => {
        seen.push("c:before");
        const value = await next(event);
        seen.push("c:after");
        return value;
    });
    const runtime = builder.build();
    await runtime.start();
    assert.equal(await runtime.dispatch("math.add", { a: 2, b: 3 }), 5);
    assert.deepEqual(seen, ["a:before", "b:before", "c:before", "c:after", "b:after", "a:after"]);
});
test("short circuit replaces the lower chain", async () => {
    let baseCalls = 0;
    const builder = createKernel();
    builder.defineEngine(createBlueprint({
        "math.add": { invoke: () => { baseCalls += 1; return 99; } },
        "log.write": { invoke: () => undefined },
    }));
    builder.on("replace", 0, "math.add", async () => 7);
    const runtime = builder.build();
    await runtime.start();
    assert.equal(await runtime.dispatch("math.add", { a: 1, b: 1 }), 7);
    assert.equal(baseCalls, 0);
});
test("input and forwarded events are cloned and deeply frozen", async () => {
    const caller = { a: 1, b: 2 };
    const builder = createKernel();
    builder.defineEngine(baseBlueprint());
    builder.on("rewrite", 0, "math.add", async (_engine, event, next) => {
        assert.ok(Object.isFrozen(event));
        const forwarded = { a: event.a + 4, b: event.b };
        const result = await next(forwarded);
        forwarded.a = 100;
        return result;
    });
    const runtime = builder.build();
    await runtime.start();
    assert.equal(await runtime.dispatch("math.add", caller), 7);
    assert.deepEqual(caller, { a: 1, b: 2 });
});
test("event values reject exotic mutable containers instead of claiming false deep immutability", async () => {
    const builder = createKernel();
    builder.defineEngine(createBlueprint({
        "data.echo": { invoke: (input) => input },
    }));
    const runtime = builder.build();
    await runtime.start();
    await assert.rejects(() => runtime.dispatch("data.echo", { value: new Map([["x", 1]]) }), UnsupportedEventValueError);
});
test("defineEngine snapshots the blueprint so later Map mutation cannot change the engine", async () => {
    const blueprint = baseBlueprint();
    const builder = createKernel();
    builder.defineEngine(blueprint);
    blueprint.events.clear();
    const runtime = builder.build();
    const engine = await runtime.start();
    assert.equal(typeof engine.math?.add, "function");
    assert.equal(await runtime.dispatch("math.add", { a: 2, b: 4 }), 6);
});
test("downstream matcher observes rewritten event", async () => {
    const seen = [];
    const builder = createKernel();
    builder.defineEngine(baseBlueprint());
    builder.on("rewrite", 0, "math.add", async (_engine, event, next) => next({ ...event, a: 9 }));
    builder.on("matched", 1, "math.add", { a: 9 }, async (_engine, event, next) => {
        seen.push("matched");
        return next(event);
    });
    const runtime = builder.build();
    await runtime.start();
    assert.equal(await runtime.dispatch("math.add", { a: 1, b: 2 }), 11);
    assert.deepEqual(seen, ["matched"]);
});
test("next is one-shot", async () => {
    const builder = createKernel();
    builder.defineEngine(baseBlueprint());
    builder.on("bad", 0, "math.add", async (_engine, event, next) => {
        await next(event);
        return next(event);
    });
    const runtime = builder.build();
    await runtime.start();
    await assert.rejects(() => runtime.dispatch("math.add", { a: 1, b: 2 }), NextMultiplicityError);
});
test("recursive nested dispatch skips only the currently executing hook", async () => {
    const seen = [];
    const builder = createKernel();
    builder.defineEngine(baseBlueprint());
    builder.on("recursive", 0, "math.add", async (engine, event, next) => {
        seen.push(`recursive:${event.a}`);
        if (event.a === 1) {
            const nested = await engine.math.add({ a: 2, b: 3 });
            assert.equal(nested, 5);
        }
        return next(event);
    });
    builder.on("other", 1, "math.add", async (_engine, event, next) => {
        seen.push(`other:${event.a}`);
        return next(event);
    });
    const runtime = builder.build();
    await runtime.start();
    assert.equal(await runtime.dispatch("math.add", { a: 1, b: 1 }), 2);
    assert.deepEqual(seen, ["recursive:1", "other:2", "other:1"]);
});
test("concurrent dispatch frames keep recursion suppression isolated", async () => {
    const seen = [];
    const builder = createKernel();
    builder.defineEngine(baseBlueprint());
    builder.on("h", 0, "math.add", async (_engine, event, next) => {
        seen.push(`enter:${event.a}`);
        await new Promise((resolve) => setTimeout(resolve, event.a === 1 ? 15 : 1));
        const result = await next(event);
        seen.push(`exit:${event.a}`);
        return result;
    });
    const runtime = builder.build();
    await runtime.start();
    const results = await Promise.all([
        runtime.dispatch("math.add", { a: 1, b: 1 }),
        runtime.dispatch("math.add", { a: 2, b: 2 }),
    ]);
    assert.deepEqual(results, [2, 4]);
    assert.equal(seen.filter((x) => x === "enter:1").length, 1);
    assert.equal(seen.filter((x) => x === "enter:2").length, 1);
});
test("engine exposes only blueprint events and unknown dispatch fails", async () => {
    const builder = createKernel();
    builder.defineEngine(baseBlueprint());
    const runtime = builder.build();
    const engine = await runtime.start();
    assert.equal(typeof engine.math?.add, "function");
    assert.equal(typeof engine.log?.write, "function");
    assert.equal(engine.fs, undefined);
    await assert.rejects(() => runtime.dispatch("fs.read", {}), UnknownEventError);
});
test("lifecycle is created -> started -> closed and builder freezes at build", async () => {
    const builder = createKernel();
    builder.defineEngine(baseBlueprint());
    const runtime = builder.build();
    assert.equal(runtime.state, "created");
    assert.throws(() => builder.on("late", 0, "math.add", async (_e, event, next) => next(event)), RuntimeStateError);
    await assert.rejects(() => runtime.dispatch("math.add", { a: 1, b: 2 }), RuntimeStateError);
    const first = await runtime.start();
    const second = await runtime.start();
    assert.equal(first, second);
    assert.equal(runtime.state, "started");
    await runtime.close();
    await runtime.close();
    assert.equal(runtime.state, "closed");
    await assert.rejects(() => runtime.start(), RuntimeClosedError);
    await assert.rejects(() => runtime.dispatch("math.add", { a: 1, b: 2 }), RuntimeClosedError);
});
test("hook and base failures are distinguishable and preserve cause", async () => {
    const baseBuilder = createKernel();
    baseBuilder.defineEngine(createBlueprint({
        "math.add": { invoke: () => { throw new TypeError("base boom"); } },
        "log.write": { invoke: () => undefined },
    }));
    const baseRuntime = baseBuilder.build();
    await baseRuntime.start();
    await assert.rejects(async () => {
        try {
            await baseRuntime.dispatch("math.add", { a: 1, b: 2 });
        }
        catch (error) {
            assert.ok(error instanceof BaseExecutionError);
            assert.ok(error.cause instanceof TypeError);
            throw error;
        }
    }, BaseExecutionError);
    const passBuilder = createKernel();
    passBuilder.defineEngine(createBlueprint({
        "math.add": { invoke: () => { throw new TypeError("base through hook"); } },
        "log.write": { invoke: () => undefined },
    }));
    passBuilder.on("pass", 0, "math.add", async (_engine, event, next) => next(event));
    const passRuntime = passBuilder.build();
    await passRuntime.start();
    await assert.rejects(() => passRuntime.dispatch("math.add", { a: 1, b: 2 }), BaseExecutionError);
    const hookBuilder = createKernel();
    hookBuilder.defineEngine(baseBlueprint());
    hookBuilder.on("bad", 0, "math.add", async () => { throw new RangeError("hook boom"); });
    const hookRuntime = hookBuilder.build();
    await hookRuntime.start();
    await assert.rejects(async () => {
        try {
            await hookRuntime.dispatch("math.add", { a: 1, b: 2 });
        }
        catch (error) {
            assert.ok(error instanceof HookExecutionError);
            assert.ok(error.cause instanceof RangeError);
            throw error;
        }
    }, HookExecutionError);
});
test("caller cancellation and deadline have distinct errors", async () => {
    const builder = createKernel();
    builder.defineEngine(createBlueprint({
        "math.add": { invoke: async () => new Promise(() => { }) },
        "log.write": { invoke: () => undefined },
    }));
    const runtime = builder.build();
    await runtime.start();
    const controller = new AbortController();
    const cancelled = runtime.dispatch("math.add", { a: 1, b: 2 }, { signal: controller.signal });
    controller.abort();
    await assert.rejects(() => cancelled, DispatchCancelledError);
    await assert.rejects(() => runtime.dispatch("math.add", { a: 1, b: 2 }, { timeoutMs: 10 }), DispatchTimeoutError);
});
test("closing aborts in-flight waits as RuntimeClosedError", async () => {
    const builder = createKernel();
    builder.defineEngine(createBlueprint({
        "math.add": { invoke: async () => new Promise(() => { }) },
        "log.write": { invoke: () => undefined },
    }));
    const runtime = builder.build();
    await runtime.start();
    const pending = runtime.dispatch("math.add", { a: 1, b: 2 });
    await runtime.close();
    await assert.rejects(() => pending, RuntimeClosedError);
});
test("golden three-hook trace has deterministic phase order", async () => {
    const trace = [];
    const builder = createKernel({ trace: (row) => trace.push(row) });
    builder.defineEngine(baseBlueprint());
    for (const [plugin, order] of [["outer", 0], ["middle", 1], ["inner", 2]]) {
        builder.on(plugin, order, "math.add", async (_engine, event, next) => next(event));
    }
    const runtime = builder.build();
    await runtime.start();
    await runtime.dispatch("math.add", { a: 1, b: 2 });
    const comparable = trace.map(({ phase, plugin }) => plugin === undefined ? { phase } : { phase, plugin });
    assert.deepEqual(comparable, THREE_HOOK_GOLDEN_TRACE);
    assert.deepEqual(trace.map((row) => row.sequence), trace.map((_, i) => i + 1));
});
import { runKernelConformance } from "../src/conformance.js";
test("published implementation-neutral conformance harness passes this kernel", async () => {
    const report = await runKernelConformance(createKernel);
    assert.equal(report.total, 21);
    assert.equal(report.failed, 0, JSON.stringify(report.cases.filter((row) => !row.passed), null, 2));
    assert.equal(report.passed, 21);
});
test("trace observer failures are isolated from dispatch semantics", async () => {
    let calls = 0;
    const builder = createKernel({ trace: () => { calls += 1; throw new Error("observer failed"); } });
    builder.defineEngine(baseBlueprint());
    builder.on("pass", 0, "math.add", async (_engine, event, next) => next(event));
    const runtime = builder.build();
    await runtime.start();
    assert.equal(await runtime.dispatch("math.add", { a: 2, b: 3 }), 5);
    assert.ok(calls > 0);
    await runtime.close();
});
//# sourceMappingURL=conformance.test.js.map