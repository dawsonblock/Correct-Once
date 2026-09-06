export const THREE_HOOK_GOLDEN_TRACE = Object.freeze([
    { phase: "dispatch.start" },
    { phase: "hook.enter", plugin: "outer" },
    { phase: "hook.enter", plugin: "middle" },
    { phase: "hook.enter", plugin: "inner" },
    { phase: "base.enter" },
    { phase: "base.exit" },
    { phase: "hook.exit", plugin: "inner" },
    { phase: "hook.exit", plugin: "middle" },
    { phase: "hook.exit", plugin: "outer" },
    { phase: "dispatch.end" },
]);
export const KERNEL_SEMANTICS_VERSION = "1.0-rc.1";
function fail(message) { throw new Error(`Conformance assertion failed: ${message}`); }
function expect(value, message) { if (!value)
    fail(message); }
function equal(actual, expected, message = "values differ") {
    if (!Object.is(actual, expected))
        fail(`${message}; actual=${String(actual)} expected=${String(expected)}`);
}
function stable(value) {
    if (value === undefined)
        return "undefined";
    return JSON.stringify(value, (_key, child) => {
        if (child && typeof child === "object" && !Array.isArray(child)) {
            return Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b)));
        }
        return child;
    });
}
function deepEqual(actual, expected, message = "structures differ") {
    const a = stable(actual);
    const b = stable(expected);
    if (a !== b)
        fail(`${message}; actual=${a} expected=${b}`);
}
function errorName(error) { return error instanceof Error ? error.name : typeof error; }
async function expectError(work, expectedName) {
    try {
        await work();
    }
    catch (error) {
        if (errorName(error) !== expectedName)
            fail(`expected ${expectedName}, received ${errorName(error)}`);
        return error instanceof Error ? error : new Error(String(error));
    }
    fail(`expected ${expectedName}, but operation succeeded`);
}
function plainBlueprint(definitions) {
    return { events: new Map(Object.entries(definitions)) };
}
function baseBlueprint() {
    return plainBlueprint({
        "math.add": { invoke: ({ a, b }) => a + b },
        "log.write": { invoke: () => undefined },
    });
}
const CASES = [
    ["registration ordering and tie stability", async (factory) => {
            const seen = [];
            const builder = factory();
            builder.defineEngine(baseBlueprint());
            for (const [plugin, order] of [["a", 10], ["b", 10], ["c", 20]]) {
                builder.on(plugin, order, "math.add", async (_engine, event, next) => {
                    seen.push(`${plugin}:before`);
                    const result = await next(event);
                    seen.push(`${plugin}:after`);
                    return result;
                });
            }
            const runtime = builder.build();
            await runtime.start();
            equal(await runtime.dispatch("math.add", { a: 2, b: 3 }), 5);
            deepEqual(seen, ["a:before", "b:before", "c:before", "c:after", "b:after", "a:after"]);
            await runtime.close();
        }],
    ["short circuit replaces lower chain", async (factory) => {
            let baseCalls = 0;
            const builder = factory();
            builder.defineEngine(plainBlueprint({
                "math.add": { invoke: () => { baseCalls += 1; return 99; } }, "log.write": { invoke: () => undefined },
            }));
            builder.on("replace", 0, "math.add", async () => 7);
            const runtime = builder.build();
            await runtime.start();
            equal(await runtime.dispatch("math.add", { a: 1, b: 1 }), 7);
            equal(baseCalls, 0);
            await runtime.close();
        }],
    ["caller input and forwarded input are immutable clones", async (factory) => {
            const caller = { a: 1, b: 2 };
            const builder = factory();
            builder.defineEngine(baseBlueprint());
            builder.on("rewrite", 0, "math.add", async (_engine, event, next) => {
                expect(Object.isFrozen(event), "hook input must be frozen");
                const forwarded = { a: event.a + 4, b: event.b };
                const result = await next(forwarded);
                forwarded.a = 100;
                return result;
            });
            const runtime = builder.build();
            await runtime.start();
            equal(await runtime.dispatch("math.add", caller), 7);
            deepEqual(caller, { a: 1, b: 2 });
            await runtime.close();
        }],
    ["base receives immutable input", async (factory) => {
            let frozen = false;
            const builder = factory();
            builder.defineEngine(plainBlueprint({
                "math.add": { invoke: (event) => { frozen = Object.isFrozen(event); return event.a + event.b; } },
                "log.write": { invoke: () => undefined },
            }));
            const runtime = builder.build();
            await runtime.start();
            await runtime.dispatch("math.add", { a: 1, b: 2 });
            expect(frozen, "base input must be frozen");
            await runtime.close();
        }],
    ["unsupported mutable containers fail explicitly", async (factory) => {
            const builder = factory();
            builder.defineEngine(plainBlueprint({ "data.echo": { invoke: (input) => input } }));
            const runtime = builder.build();
            await runtime.start();
            await expectError(() => runtime.dispatch("data.echo", { value: new Map([["x", 1]]) }), "UnsupportedEventValueError");
            await runtime.close();
        }],
    ["engine blueprint is snapshotted", async (factory) => {
            const blueprint = baseBlueprint();
            const builder = factory();
            builder.defineEngine(blueprint);
            blueprint.events.clear();
            const runtime = builder.build();
            const engine = await runtime.start();
            equal(typeof engine.math?.add, "function");
            equal(await runtime.dispatch("math.add", { a: 2, b: 4 }), 6);
            await runtime.close();
        }],
    ["matcher sees rewritten downstream event", async (factory) => {
            let matched = 0;
            const builder = factory();
            builder.defineEngine(baseBlueprint());
            builder.on("rewrite", 0, "math.add", async (_engine, event, next) => next({ ...event, a: 9 }));
            builder.on("match", 1, "math.add", { a: 9 }, async (_engine, event, next) => { matched += 1; return next(event); });
            const runtime = builder.build();
            await runtime.start();
            equal(await runtime.dispatch("math.add", { a: 1, b: 2 }), 11);
            equal(matched, 1);
            await runtime.close();
        }],
    ["next is one-shot", async (factory) => {
            const builder = factory();
            builder.defineEngine(baseBlueprint());
            builder.on("bad", 0, "math.add", async (_engine, event, next) => { await next(event); return next(event); });
            const runtime = builder.build();
            await runtime.start();
            await expectError(() => runtime.dispatch("math.add", { a: 1, b: 2 }), "NextMultiplicityError");
            await runtime.close();
        }],
    ["recursive nested dispatch suppresses only current hook", async (factory) => {
            const seen = [];
            const builder = factory();
            builder.defineEngine(baseBlueprint());
            builder.on("recursive", 0, "math.add", async (engine, event, next) => {
                seen.push(`recursive:${event.a}`);
                if (event.a === 1)
                    equal(await engine.math.add({ a: 2, b: 3 }), 5);
                return next(event);
            });
            builder.on("other", 1, "math.add", async (_engine, event, next) => { seen.push(`other:${event.a}`); return next(event); });
            const runtime = builder.build();
            await runtime.start();
            equal(await runtime.dispatch("math.add", { a: 1, b: 1 }), 2);
            deepEqual(seen, ["recursive:1", "other:2", "other:1"]);
            await runtime.close();
        }],
    ["concurrent dispatch recursion frames are isolated", async (factory) => {
            const seen = [];
            const builder = factory();
            builder.defineEngine(baseBlueprint());
            builder.on("h", 0, "math.add", async (_engine, event, next) => {
                seen.push(`enter:${event.a}`);
                await new Promise((resolve) => setTimeout(resolve, event.a === 1 ? 12 : 1));
                return next(event);
            });
            const runtime = builder.build();
            await runtime.start();
            deepEqual(await Promise.all([runtime.dispatch("math.add", { a: 1, b: 1 }), runtime.dispatch("math.add", { a: 2, b: 2 })]), [2, 4]);
            equal(seen.filter((x) => x === "enter:1").length, 1);
            equal(seen.filter((x) => x === "enter:2").length, 1);
            await runtime.close();
        }],
    ["engine surface is blueprint-only and unknown events fail", async (factory) => {
            const builder = factory();
            builder.defineEngine(baseBlueprint());
            const runtime = builder.build();
            const engine = await runtime.start();
            equal(typeof engine.math?.add, "function");
            equal(typeof engine.log?.write, "function");
            equal(engine.fs, undefined);
            await expectError(() => runtime.dispatch("fs.read", {}), "UnknownEventError");
            await runtime.close();
        }],
    ["lifecycle is created started closed and builder freezes", async (factory) => {
            const builder = factory();
            builder.defineEngine(baseBlueprint());
            const runtime = builder.build();
            equal(runtime.state, "created");
            let mutationError;
            try {
                builder.on("late", 0, "math.add", async (_e, event, next) => next(event));
            }
            catch (error) {
                mutationError = error;
            }
            equal(errorName(mutationError), "RuntimeStateError");
            await expectError(() => runtime.dispatch("math.add", { a: 1, b: 2 }), "RuntimeStateError");
            const first = await runtime.start();
            const second = await runtime.start();
            equal(first, second);
            equal(runtime.state, "started");
            await runtime.close();
            await runtime.close();
            equal(runtime.state, "closed");
            await expectError(() => runtime.start(), "RuntimeClosedError");
            await expectError(() => runtime.dispatch("math.add", { a: 1, b: 2 }), "RuntimeClosedError");
        }],
    ["hook and base failures have distinct semantic errors and causes", async (factory) => {
            const baseBuilder = factory();
            baseBuilder.defineEngine(plainBlueprint({ "math.add": { invoke: () => { throw new TypeError("base"); } }, "log.write": { invoke: () => undefined } }));
            const baseRuntime = baseBuilder.build();
            await baseRuntime.start();
            const baseError = await expectError(() => baseRuntime.dispatch("math.add", { a: 1, b: 2 }), "BaseExecutionError");
            equal(baseError.cause instanceof TypeError, true);
            await baseRuntime.close();
            const hookBuilder = factory();
            hookBuilder.defineEngine(baseBlueprint());
            hookBuilder.on("bad", 0, "math.add", async () => { throw new RangeError("hook"); });
            const hookRuntime = hookBuilder.build();
            await hookRuntime.start();
            const hookError = await expectError(() => hookRuntime.dispatch("math.add", { a: 1, b: 2 }), "HookExecutionError");
            equal(hookError.cause instanceof RangeError, true);
            await hookRuntime.close();
        }],
    ["caller cancellation and deadline are distinct", async (factory) => {
            const builder = factory();
            builder.defineEngine(plainBlueprint({ "math.add": { invoke: async () => new Promise(() => { }) }, "log.write": { invoke: () => undefined } }));
            const runtime = builder.build();
            await runtime.start();
            const controller = new AbortController();
            const pending = runtime.dispatch("math.add", { a: 1, b: 2 }, { signal: controller.signal });
            controller.abort();
            await expectError(() => pending, "DispatchCancelledError");
            await expectError(() => runtime.dispatch("math.add", { a: 1, b: 2 }, { timeoutMs: 8 }), "DispatchTimeoutError");
            await runtime.close();
        }],
    ["next.signal carries cooperative cancellation", async (factory) => {
            let observedAbort = false;
            const builder = factory();
            builder.defineEngine(baseBlueprint());
            builder.on("wait", 0, "math.add", async (_engine, event, next) => {
                await new Promise((resolve) => {
                    if (next.signal.aborted) {
                        observedAbort = true;
                        resolve();
                        return;
                    }
                    next.signal.addEventListener("abort", () => { observedAbort = true; resolve(); }, { once: true });
                });
                return next(event);
            });
            const runtime = builder.build();
            await runtime.start();
            const controller = new AbortController();
            const pending = runtime.dispatch("math.add", { a: 1, b: 2 }, { signal: controller.signal });
            controller.abort();
            await expectError(() => pending, "DispatchCancelledError");
            expect(observedAbort, "hook must observe cancellation on next.signal");
            await runtime.close();
        }],
    ["close aborts in-flight dispatch as RuntimeClosedError", async (factory) => {
            const builder = factory();
            builder.defineEngine(plainBlueprint({ "math.add": { invoke: async () => new Promise(() => { }) }, "log.write": { invoke: () => undefined } }));
            const runtime = builder.build();
            await runtime.start();
            const pending = runtime.dispatch("math.add", { a: 1, b: 2 });
            await runtime.close();
            await expectError(() => pending, "RuntimeClosedError");
        }],
    ["origin is diagnostic and visible to hooks", async (factory) => {
            let seen;
            const builder = factory();
            builder.defineEngine(baseBlueprint());
            builder.on("observe", 0, "math.add", async (_engine, event, next) => { seen = next.origin; return next(event); });
            const runtime = builder.build();
            await runtime.start();
            await runtime.dispatch("math.add", { a: 1, b: 2 }, { origin: "caller-label" });
            equal(seen, "caller-label");
            await runtime.close();
        }],
    ["matcher array-any and empty-array-never semantics", async (factory) => {
            const seen = [];
            const builder = factory();
            builder.defineEngine(baseBlueprint());
            builder.on("any", 0, "math.add", { a: [4, 9] }, async (_engine, event, next) => { seen.push("any"); return next(event); });
            builder.on("never", 1, "math.add", { b: [] }, async (_engine, event, next) => { seen.push("never"); return next(event); });
            const runtime = builder.build();
            await runtime.start();
            equal(await runtime.dispatch("math.add", { a: 9, b: 1 }), 10);
            deepEqual(seen, ["any"]);
            await runtime.close();
        }],
    ["next metadata is immutable and identifies the active event", async (factory) => {
            let observed;
            const builder = factory();
            builder.defineEngine(baseBlueprint());
            builder.on("meta", 0, "math.add", async (_engine, event, next) => {
                observed = { frozen: Object.isFrozen(next), event: next.event, origin: next.origin, isSelf: next.is("math.add", event), isOther: next.is("log.write", event) };
                return next(event);
            });
            const runtime = builder.build();
            await runtime.start();
            await runtime.dispatch("math.add", { a: 1, b: 2 }, { origin: "meta-test" });
            deepEqual(observed, { frozen: true, event: "math.add", origin: "meta-test", isSelf: true, isOther: false });
            await runtime.close();
        }],
    ["default runtime deadline applies when dispatch has no override", async (factory) => {
            const builder = factory({ defaultTimeoutMs: 8 });
            builder.defineEngine(plainBlueprint({
                "math.add": { invoke: async () => new Promise(() => { }) }, "log.write": { invoke: () => undefined },
            }));
            const runtime = builder.build();
            await runtime.start();
            await expectError(() => runtime.dispatch("math.add", { a: 1, b: 2 }), "DispatchTimeoutError");
            await runtime.close();
        }],
    ["golden three-hook trace is deterministic", async (factory) => {
            const trace = [];
            const builder = factory({ trace: (row) => trace.push(row) });
            builder.defineEngine(baseBlueprint());
            for (const [plugin, order] of [["outer", 0], ["middle", 1], ["inner", 2]]) {
                builder.on(plugin, order, "math.add", async (_engine, event, next) => next(event));
            }
            const runtime = builder.build();
            await runtime.start();
            await runtime.dispatch("math.add", { a: 1, b: 2 });
            const comparable = trace.map(({ phase, plugin }) => plugin === undefined ? { phase } : { phase, plugin });
            deepEqual(comparable, THREE_HOOK_GOLDEN_TRACE);
            deepEqual(trace.map((row) => row.sequence), trace.map((_, index) => index + 1));
            await runtime.close();
        }],
];
export const KERNEL_CONFORMANCE_CASE_NAMES = Object.freeze(CASES.map(([name]) => name));
export const KERNEL_CONFORMANCE_CASE_COUNT = KERNEL_CONFORMANCE_CASE_NAMES.length;
/**
 * Execute the observable kernel contract against any implementation exposing the
 * public KernelBuilder/Runtime shape. The harness compares semantic error names
 * instead of constructor identity so separately packaged implementations can be
 * qualified without sharing internal classes.
 */
export async function runKernelConformance(factory) {
    const results = [];
    for (const [name, run] of CASES) {
        const started = Date.now();
        try {
            await run(factory);
            results.push(Object.freeze({ name, passed: true, durationMs: Date.now() - started }));
        }
        catch (error) {
            const normalized = error instanceof Error ? error : new Error(String(error));
            results.push(Object.freeze({
                name,
                passed: false,
                durationMs: Date.now() - started,
                error: Object.freeze({ name: normalized.name, message: normalized.message }),
            }));
        }
    }
    const passed = results.filter((row) => row.passed).length;
    return Object.freeze({
        semanticsVersion: KERNEL_SEMANTICS_VERSION,
        passed,
        failed: results.length - passed,
        total: results.length,
        cases: Object.freeze(results),
    });
}
//# sourceMappingURL=conformance.js.map