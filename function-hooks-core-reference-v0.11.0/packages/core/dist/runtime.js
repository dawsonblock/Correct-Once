import { AsyncLocalStorage } from "node:async_hooks";
import { BaseExecutionError, FunctionHooksError, DispatchCancelledError, DispatchTimeoutError, HookExecutionError, NextMultiplicityError, RuntimeClosedError, RuntimeStateError, UnknownEventError, } from "./errors.js";
import { immutableEvent } from "./freeze.js";
import { substructuralMatch } from "./matcher.js";
import { snapshotBlueprint } from "./blueprint.js";
function abortError(kind, eventName) {
    if (kind === "deadline")
        return new DispatchTimeoutError(`Dispatch ${eventName} exceeded its deadline.`);
    if (kind === "runtime-closed")
        return new RuntimeClosedError(`Runtime closed while ${eventName} was in flight.`);
    return new DispatchCancelledError(`Dispatch ${eventName} was cancelled.`);
}
function raceAbort(work, signal, eventName) {
    if (signal.aborted)
        return Promise.reject(abortError(signal.reason, eventName));
    return new Promise((resolve, reject) => {
        const onAbort = () => reject(abortError(signal.reason, eventName));
        signal.addEventListener("abort", onAbort, { once: true });
        work.then((value) => {
            signal.removeEventListener("abort", onAbort);
            resolve(value);
        }, (error) => {
            signal.removeEventListener("abort", onAbort);
            reject(error);
        });
    });
}
function normalizeError(error) {
    return error instanceof Error ? error : new Error(String(error));
}
class KernelRuntime {
    #hooks;
    #blueprint;
    #trace;
    #defaultTimeoutMs;
    #als = new AsyncLocalStorage();
    #activeControllers = new Set();
    #state = "created";
    #engine;
    #dispatchCounter = 0;
    #traceSequence = 0;
    constructor(blueprint, hooks, options) {
        this.#blueprint = blueprint;
        this.#hooks = [...hooks].sort((a, b) => a.order - b.order || a.registrationIndex - b.registrationIndex);
        this.#trace = options.trace;
        this.#defaultTimeoutMs = options.defaultTimeoutMs;
    }
    get state() {
        return this.#state;
    }
    async start() {
        if (this.#state === "closed")
            throw new RuntimeClosedError("Cannot start a closed runtime.");
        if (this.#state === "started")
            return this.#engine;
        this.#engine = this.#materializeEngine();
        this.#state = "started";
        return this.#engine;
    }
    async dispatch(eventName, input, options = {}) {
        if (this.#state === "closed")
            throw new RuntimeClosedError("Cannot dispatch on a closed runtime.");
        if (this.#state !== "started" || !this.#engine) {
            throw new RuntimeStateError("Runtime has not been started. Call start() before dispatch().");
        }
        const definition = this.#blueprint.events.get(eventName);
        if (!definition)
            throw new UnknownEventError(`Unknown event: ${eventName}`);
        const rootEvent = immutableEvent(input);
        const parent = this.#als.getStore();
        const origin = options.origin ?? parent?.currentPlugin ?? "engine";
        const skipHookIds = parent?.skipHookIds ?? new Set();
        const timeoutMs = options.timeoutMs ?? this.#defaultTimeoutMs;
        if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
            throw new RangeError("timeoutMs must be a finite positive number.");
        }
        const dispatchId = `dispatch-${++this.#dispatchCounter}`;
        const controller = new AbortController();
        this.#activeControllers.add(controller);
        const callerSignal = options.signal;
        const onCallerAbort = () => {
            if (!controller.signal.aborted)
                controller.abort("caller");
        };
        if (callerSignal?.aborted)
            controller.abort("caller");
        else
            callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
        let timer;
        if (timeoutMs !== undefined) {
            timer = setTimeout(() => {
                if (!controller.signal.aborted) {
                    controller.abort("deadline");
                    this.#emit({ dispatchId, event: eventName, origin, phase: "dispatch.abort", detail: { reason: "deadline", timeoutMs } });
                }
            }, timeoutMs);
        }
        this.#emit({ dispatchId, event: eventName, origin, phase: "dispatch.start" });
        const selected = this.#hooks.filter((hook) => hook.event === eventName && !skipHookIds.has(hook.id));
        const invokeAt = async (index, currentEvent, inheritedSkip) => {
            if (controller.signal.aborted)
                throw abortError(controller.signal.reason, eventName);
            const frozenEvent = immutableEvent(currentEvent);
            let cursor = index;
            while (cursor < selected.length) {
                const candidate = selected[cursor];
                if (candidate.matcher === undefined || substructuralMatch(candidate.matcher, frozenEvent))
                    break;
                cursor += 1;
            }
            if (cursor >= selected.length) {
                this.#emit({ dispatchId, event: eventName, origin, phase: "base.enter" });
                try {
                    const value = await raceAbort(Promise.resolve(this.#als.run({ skipHookIds: inheritedSkip }, () => definition.invoke(frozenEvent, this.#engine))), controller.signal, eventName);
                    this.#emit({ dispatchId, event: eventName, origin, phase: "base.exit" });
                    return value;
                }
                catch (error) {
                    if (error instanceof DispatchCancelledError || error instanceof RuntimeClosedError)
                        throw error;
                    throw new BaseExecutionError(`Base implementation for ${eventName} failed.`, { cause: normalizeError(error) });
                }
            }
            const hook = selected[cursor];
            const hookSkip = new Set(inheritedSkip);
            hookSkip.add(hook.id);
            let nextCalls = 0;
            const next = ((forwarded) => {
                nextCalls += 1;
                if (nextCalls > 1) {
                    return Promise.reject(new NextMultiplicityError(`Hook ${hook.id} called next() more than once for ${eventName}.`));
                }
                return this.#als.run({ skipHookIds: inheritedSkip }, () => invokeAt(cursor + 1, forwarded, inheritedSkip));
            });
            Object.defineProperties(next, {
                signal: { value: controller.signal, enumerable: true },
                event: { value: eventName, enumerable: true },
                origin: { value: origin, enumerable: true },
                is: { value: (type, _candidate) => type === eventName, enumerable: true },
            });
            Object.freeze(next);
            this.#emit({ dispatchId, event: eventName, origin, plugin: hook.plugin, hookId: hook.id, phase: "hook.enter" });
            try {
                const value = await raceAbort(Promise.resolve(this.#als.run({ skipHookIds: hookSkip, currentPlugin: hook.plugin }, () => hook.callback(this.#engine, frozenEvent, next))), controller.signal, eventName);
                this.#emit({ dispatchId, event: eventName, origin, plugin: hook.plugin, hookId: hook.id, phase: "hook.exit", detail: { nextCalls } });
                return value;
            }
            catch (error) {
                if (error instanceof FunctionHooksError)
                    throw error;
                throw new HookExecutionError(`Hook ${hook.id} failed for ${eventName}.`, { cause: normalizeError(error) });
            }
        };
        try {
            const result = await invokeAt(0, rootEvent, skipHookIds);
            this.#emit({ dispatchId, event: eventName, origin, phase: "dispatch.end" });
            return result;
        }
        catch (error) {
            this.#emit({ dispatchId, event: eventName, origin, phase: "dispatch.error", detail: { error: normalizeError(error).name } });
            throw error;
        }
        finally {
            if (timer !== undefined)
                clearTimeout(timer);
            callerSignal?.removeEventListener("abort", onCallerAbort);
            this.#activeControllers.delete(controller);
            if (!controller.signal.aborted)
                controller.abort("complete");
        }
    }
    async close() {
        if (this.#state === "closed")
            return;
        this.#state = "closed";
        for (const controller of this.#activeControllers) {
            if (!controller.signal.aborted)
                controller.abort("runtime-closed");
        }
        this.#activeControllers.clear();
        this.#engine = undefined;
    }
    #materializeEngine() {
        const nouns = new Map();
        for (const name of this.#blueprint.events.keys()) {
            const [noun, verb] = name.split(".");
            const table = nouns.get(noun) ?? {};
            if (Object.prototype.hasOwnProperty.call(table, verb)) {
                throw new Error(`Duplicate engine method ${name}.`);
            }
            table[verb] = (input) => this.dispatch(name, input);
            nouns.set(noun, table);
        }
        const object = {};
        for (const [noun, table] of nouns)
            object[noun] = Object.freeze(table);
        return Object.freeze(object);
    }
    #emit(record) {
        const trace = this.#trace;
        if (!trace)
            return;
        const emitted = Object.freeze({ ...record, sequence: ++this.#traceSequence });
        // Trace observers are explicitly observational. A broken telemetry sink must
        // never change dispatch success, failure, ordering, cancellation, or lifecycle.
        try {
            trace(emitted);
        }
        catch { /* observational callback failures are isolated */ }
    }
}
class Builder {
    #options;
    #hooks = [];
    #blueprint;
    #built = false;
    #registrationIndex = 0;
    constructor(options) {
        this.#options = options;
    }
    on(plugin, order, event, matcherOrHook, maybeHook) {
        this.#assertMutable();
        if (!plugin.trim())
            throw new TypeError("plugin must be a non-empty string.");
        if (!Number.isFinite(order))
            throw new TypeError("order must be a finite number.");
        const callback = (maybeHook ?? matcherOrHook);
        const matcher = maybeHook === undefined ? undefined : matcherOrHook;
        if (typeof callback !== "function")
            throw new TypeError(`Hook callback for ${event} must be a function.`);
        const registrationIndex = this.#registrationIndex++;
        this.#hooks.push({
            id: `${plugin}:${registrationIndex}:${event}`,
            plugin,
            order,
            registrationIndex,
            event,
            ...(matcher === undefined ? {} : { matcher }),
            callback,
        });
    }
    defineEngine(blueprint) {
        this.#assertMutable();
        if (this.#blueprint)
            throw new RuntimeStateError("Engine blueprint has already been defined.");
        this.#blueprint = snapshotBlueprint(blueprint);
    }
    build() {
        this.#assertMutable();
        if (!this.#blueprint)
            throw new RuntimeStateError("defineEngine() must be called before build().");
        this.#built = true;
        return new KernelRuntime(this.#blueprint, this.#hooks, this.#options);
    }
    #assertMutable() {
        if (this.#built)
            throw new RuntimeStateError("KernelBuilder is immutable after build().");
    }
}
export function createKernel(options = {}) {
    return new Builder(options);
}
export function describeHooks(builder) {
    void builder;
    // Introspection is deliberately not part of the stable builder contract in 0.4.
    return Object.freeze([]);
}
//# sourceMappingURL=runtime.js.map