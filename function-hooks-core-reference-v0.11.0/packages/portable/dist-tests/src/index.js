class PortableKernelError extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = new.target.name;
    }
}
class RuntimeStateError extends PortableKernelError {
}
class RuntimeClosedError extends RuntimeStateError {
}
class UnknownEventError extends PortableKernelError {
}
class UnsupportedEventValueError extends PortableKernelError {
}
class NextMultiplicityError extends PortableKernelError {
}
class DispatchCancelledError extends PortableKernelError {
}
class DispatchTimeoutError extends DispatchCancelledError {
}
class HookExecutionError extends PortableKernelError {
}
class BaseExecutionError extends PortableKernelError {
}
function normalizeError(error) {
    return error instanceof Error ? error : new Error(String(error));
}
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
        work.then((value) => { signal.removeEventListener("abort", onAbort); resolve(value); }, (error) => { signal.removeEventListener("abort", onAbort); reject(error); });
    });
}
function assertPlainValue(value, seen = new WeakSet()) {
    if (value === null || typeof value !== "object")
        return;
    if (seen.has(value))
        return;
    seen.add(value);
    if (Array.isArray(value)) {
        for (const child of value)
            assertPlainValue(child, seen);
        return;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
        const name = proto?.constructor?.name ?? "unknown";
        throw new UnsupportedEventValueError(`Event values must contain only primitives, arrays, and plain objects; received ${name}.`);
    }
    for (const key of Reflect.ownKeys(value)) {
        assertPlainValue(value[key], seen);
    }
}
function deepFreeze(value, seen = new WeakSet()) {
    if (value === null || (typeof value !== "object" && typeof value !== "function"))
        return value;
    const object = value;
    if (seen.has(object))
        return value;
    seen.add(object);
    for (const key of Reflect.ownKeys(object))
        deepFreeze(object[key], seen);
    return Object.freeze(value);
}
function immutableEvent(value) {
    let clone;
    try {
        clone = structuredClone(value);
    }
    catch (error) {
        throw new UnsupportedEventValueError("Event value is not structured-cloneable.", { cause: normalizeError(error) });
    }
    assertPlainValue(clone);
    return deepFreeze(clone);
}
function isPlainObject(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}
function substructuralMatch(pattern, value) {
    if (Array.isArray(pattern))
        return pattern.length > 0 && pattern.some((candidate) => substructuralMatch(candidate, value));
    if (isPlainObject(pattern)) {
        if (!isPlainObject(value))
            return false;
        return Object.entries(pattern).every(([key, child]) => Object.prototype.hasOwnProperty.call(value, key) && substructuralMatch(child, value[key]));
    }
    return Object.is(pattern, value);
}
function snapshotBlueprint(blueprint) {
    if (!blueprint || !(blueprint.events instanceof Map))
        throw new TypeError("Engine blueprint must expose an events Map.");
    return Object.freeze({ events: new Map(blueprint.events) });
}
class PortableRuntime {
    #blueprint;
    #hooks;
    #trace;
    #defaultTimeoutMs;
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
    get state() { return this.#state; }
    async start() {
        if (this.#state === "closed")
            throw new RuntimeClosedError("Cannot start a closed runtime.");
        if (this.#state === "started")
            return this.#engine;
        this.#engine = this.#materializeEngine(new Set());
        this.#state = "started";
        return this.#engine;
    }
    dispatch(event, input, options = {}) {
        return this.#dispatchInternal(event, input, options, new Set());
    }
    async #dispatchInternal(eventName, input, options, inheritedSkip) {
        if (this.#state === "closed")
            throw new RuntimeClosedError("Cannot dispatch on a closed runtime.");
        if (this.#state !== "started" || !this.#engine)
            throw new RuntimeStateError("Runtime has not been started. Call start() before dispatch().");
        const definition = this.#blueprint.events.get(eventName);
        if (!definition)
            throw new UnknownEventError(`Unknown event: ${eventName}`);
        const rootEvent = immutableEvent(input);
        const origin = options.origin ?? "engine";
        const timeoutMs = options.timeoutMs ?? this.#defaultTimeoutMs;
        if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0))
            throw new RangeError("timeoutMs must be a finite positive number.");
        const dispatchId = `portable-${++this.#dispatchCounter}`;
        const controller = new AbortController();
        this.#activeControllers.add(controller);
        const callerSignal = options.signal;
        const onCallerAbort = () => { if (!controller.signal.aborted)
            controller.abort("caller"); };
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
        const selected = this.#hooks.filter((hook) => hook.event === eventName && !inheritedSkip.has(hook.id));
        const invokeAt = async (index, currentEvent, skip) => {
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
                const baseEngine = this.#materializeEngine(skip);
                try {
                    const value = await raceAbort(Promise.resolve(definition.invoke(frozenEvent, baseEngine)), controller.signal, eventName);
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
            const hookSkip = new Set(skip);
            hookSkip.add(hook.id);
            let nextCalls = 0;
            const next = ((forwarded) => {
                nextCalls += 1;
                if (nextCalls > 1)
                    return Promise.reject(new NextMultiplicityError(`Hook ${hook.id} called next() more than once for ${eventName}.`));
                return invokeAt(cursor + 1, forwarded, skip);
            });
            Object.defineProperties(next, {
                signal: { value: controller.signal, enumerable: true },
                event: { value: eventName, enumerable: true },
                origin: { value: origin, enumerable: true },
                is: { value: (type, _candidate) => type === eventName, enumerable: true },
            });
            Object.freeze(next);
            const hookEngine = this.#materializeEngine(hookSkip);
            this.#emit({ dispatchId, event: eventName, origin, plugin: hook.plugin, hookId: hook.id, phase: "hook.enter" });
            try {
                const value = await raceAbort(Promise.resolve(hook.callback(hookEngine, frozenEvent, next)), controller.signal, eventName);
                this.#emit({ dispatchId, event: eventName, origin, plugin: hook.plugin, hookId: hook.id, phase: "hook.exit", detail: { nextCalls } });
                return value;
            }
            catch (error) {
                if (error instanceof PortableKernelError)
                    throw error;
                throw new HookExecutionError(`Hook ${hook.id} failed for ${eventName}.`, { cause: normalizeError(error) });
            }
        };
        try {
            const result = await invokeAt(0, rootEvent, inheritedSkip);
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
        for (const controller of this.#activeControllers)
            if (!controller.signal.aborted)
                controller.abort("runtime-closed");
        this.#activeControllers.clear();
        this.#engine = undefined;
    }
    #materializeEngine(skip) {
        const nouns = new Map();
        for (const name of this.#blueprint.events.keys()) {
            const parts = name.split(".");
            if (parts.length !== 2 || !parts[0] || !parts[1])
                throw new TypeError(`Invalid engine event name: ${name}`);
            const [noun, verb] = parts;
            const table = nouns.get(noun) ?? {};
            if (Object.prototype.hasOwnProperty.call(table, verb))
                throw new TypeError(`Duplicate engine method ${name}.`);
            table[verb] = (input) => this.#dispatchInternal(name, input, {}, skip);
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
class PortableBuilder {
    #options;
    #hooks = [];
    #blueprint;
    #built = false;
    #registrationIndex = 0;
    constructor(options) { this.#options = options; }
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
        this.#hooks.push({ id: `${plugin}:${registrationIndex}:${event}`, plugin, order, registrationIndex, event, ...(matcher === undefined ? {} : { matcher }), callback });
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
        return new PortableRuntime(this.#blueprint, this.#hooks, this.#options);
    }
    #assertMutable() { if (this.#built)
        throw new RuntimeStateError("KernelBuilder is immutable after build()."); }
}
/**
 * Independent kernel implementation. Only public TypeScript contracts are
 * imported from @function-hooks/core; no reference-runtime code is reused.
 */
export function createPortableKernel(options = {}) {
    return new PortableBuilder(options);
}
//# sourceMappingURL=index.js.map