import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { BudgetController } from "@function-hooks/assurance";
import { serializedBytes } from "@function-hooks/assurance";
import { assertSchema } from "@function-hooks/assurance";
import { BottomHookError, DispatchTimeoutError, MessageSizeError, NextMultiplicityError, UnknownEventError, } from "./errors.js";
import { immutableEvent, deepFreeze } from "./freeze.js";
import { substructuralMatch } from "./matcher.js";
import { emptyBlueprint, validateBlueprintTransition } from "./blueprint.js";
function abortPromise(signal, eventName) {
    return new Promise((_, reject) => {
        if (signal.aborted) {
            reject(new DispatchTimeoutError(`Dispatch ${eventName} exceeded its deadline.`));
            return;
        }
        signal.addEventListener("abort", () => {
            if (signal.reason === "deadline-exceeded")
                reject(new DispatchTimeoutError(`Dispatch ${eventName} exceeded its deadline.`));
        }, { once: true });
    });
}
async function raceDeadline(work, signal, eventName) {
    if (signal.aborted && signal.reason === "deadline-exceeded")
        throw new DispatchTimeoutError(`Dispatch ${eventName} exceeded its deadline.`);
    return Promise.race([work, abortPromise(signal, eventName)]);
}
/** @deprecated Compatibility runtime. New code should use createKernel() from @function-hooks/core. */
export class FunctionHooksRuntime {
    #hooks = [];
    #engineCreateHooks = [];
    #als = new AsyncLocalStorage();
    #trace;
    #budgets;
    #engine;
    #blueprint;
    constructor(options = {}) {
        this.#trace = options.trace;
        this.#budgets = new BudgetController(options.budgets);
    }
    registrar(plugin, pluginOrder) {
        let hookOrder = 0;
        const on = ((event, arg2, arg3) => {
            const matcher = arg3 === undefined ? undefined : arg2;
            const callback = (arg3 === undefined ? arg2 : arg3);
            if (typeof callback !== "function")
                throw new TypeError(`Hook callback for ${event} must be a function.`);
            const id = `${plugin}:${hookOrder}:${event}`;
            if (event === "engine.create") {
                if (matcher !== undefined)
                    throw new TypeError("engine.create does not accept a matcher in this reference build.");
                this.#engineCreateHooks.push({ id, plugin, pluginOrder, hookOrder: hookOrder++, callback: callback });
                return;
            }
            this.#hooks.push({ id, plugin, pluginOrder, hookOrder: hookOrder++, event, ...(matcher === undefined ? {} : { matcher }), callback });
        });
        return on;
    }
    get engine() {
        if (!this.#engine)
            throw new Error("Runtime has not been started. Call start() first.");
        return this.#engine;
    }
    get blueprint() {
        if (!this.#blueprint)
            throw new Error("Runtime has not been started. Call start() first.");
        return this.#blueprint;
    }
    async start() {
        if (this.#engine)
            return this.#engine;
        const blueprint = await this.#buildBlueprint();
        this.#blueprint = blueprint;
        this.#engine = this.#materializeEngine(blueprint);
        return this.#engine;
    }
    async dispatch(eventName, input, explicitOrigin) {
        if (!this.#engine || !this.#blueprint)
            throw new Error("Runtime has not been started.");
        const definition = this.#blueprint.events.get(eventName);
        if (!definition)
            throw new UnknownEventError(`Unknown or withheld event: ${eventName}`);
        const limits = this.#budgets.limitsFor(eventName, definition);
        const inputBytes = serializedBytes(input);
        if (inputBytes > limits.maxInputBytes)
            throw new MessageSizeError(`Input for ${eventName} is ${inputBytes} bytes; limit is ${limits.maxInputBytes}.`);
        assertSchema(definition.inputSchema, input, `${eventName}.input`);
        const parent = this.#als.getStore();
        const origin = explicitOrigin ?? parent?.currentPlugin ?? "engine";
        const skipHookIds = parent?.skipHookIds ?? new Set();
        const dispatchId = randomUUID();
        const controller = new AbortController();
        const timer = setTimeout(() => {
            if (!controller.signal.aborted) {
                controller.abort("deadline-exceeded");
                this.#emit({ dispatchId, event: eventName, origin, phase: "dispatch.abort", at: Date.now(), detail: { reason: "deadline-exceeded", deadlineMs: limits.deadlineMs } });
            }
        }, limits.deadlineMs);
        const rootEvent = immutableEvent(input);
        this.#emit({ dispatchId, event: eventName, origin, phase: "dispatch.start", at: Date.now(), detail: { inputBytes, limits } });
        const selected = this.#hooks
            .filter((hook) => (hook.event === eventName || hook.event === "*") && !skipHookIds.has(hook.id))
            .sort((a, b) => a.pluginOrder - b.pluginOrder || a.hookOrder - b.hookOrder);
        const invokeAt = async (index, event, inheritedSkip) => {
            if (controller.signal.aborted && controller.signal.reason === "deadline-exceeded")
                throw new DispatchTimeoutError(`Dispatch ${eventName} exceeded its deadline.`);
            assertSchema(definition.inputSchema, event, `${eventName}.forwarded`);
            const forwardedBytes = serializedBytes(event);
            if (forwardedBytes > limits.maxInputBytes)
                throw new MessageSizeError(`Forwarded input for ${eventName} is ${forwardedBytes} bytes; limit is ${limits.maxInputBytes}.`);
            const frozenEvent = immutableEvent(event);
            let cursor = index;
            while (cursor < selected.length && selected[cursor].matcher !== undefined && !substructuralMatch(selected[cursor].matcher, frozenEvent))
                cursor += 1;
            if (cursor >= selected.length) {
                this.#emit({ dispatchId, event: eventName, origin, phase: "base.enter", at: Date.now() });
                const value = await raceDeadline(Promise.resolve(this.#als.run({ skipHookIds: inheritedSkip, currentPlugin: definition.owner }, () => definition.invoke(frozenEvent, this.engine))), controller.signal, eventName);
                assertSchema(definition.resultSchema, value, `${eventName}.result`);
                const resultBytes = serializedBytes(value);
                if (resultBytes > limits.maxResultBytes)
                    throw new MessageSizeError(`Result for ${eventName} is ${resultBytes} bytes; limit is ${limits.maxResultBytes}.`);
                this.#emit({ dispatchId, event: eventName, origin, phase: "base.exit", at: Date.now(), detail: { resultBytes } });
                return value;
            }
            const hook = selected[cursor];
            const hookSkip = new Set(inheritedSkip);
            hookSkip.add(hook.id);
            const continuationContext = { skipHookIds: inheritedSkip };
            let nextCalls = 0;
            const nextFunction = ((forwarded) => {
                nextCalls += 1;
                if (nextCalls > limits.maxNextCalls) {
                    return Promise.reject(new NextMultiplicityError(`Hook ${hook.id} called next() ${nextCalls} times for ${eventName}; limit is ${limits.maxNextCalls}.`));
                }
                return this.#als.run(continuationContext, () => invokeAt(cursor + 1, forwarded, inheritedSkip));
            });
            Object.defineProperties(nextFunction, {
                signal: { value: controller.signal, enumerable: true },
                event: { value: eventName, enumerable: true },
                origin: { value: origin, enumerable: true },
                is: { value: (type, _candidate) => type === eventName, enumerable: true },
            });
            Object.freeze(nextFunction);
            this.#emit({ dispatchId, event: eventName, origin, plugin: hook.plugin, hookId: hook.id, phase: "hook.enter", at: Date.now() });
            const value = await raceDeadline(Promise.resolve(this.#als.run({ skipHookIds: hookSkip, currentPlugin: hook.plugin }, () => hook.callback(this.engine, frozenEvent, nextFunction))), controller.signal, eventName);
            const resultBytes = serializedBytes(value);
            if (resultBytes > limits.maxResultBytes)
                throw new MessageSizeError(`Hook result for ${eventName} is ${resultBytes} bytes; limit is ${limits.maxResultBytes}.`);
            this.#emit({ dispatchId, event: eventName, origin, plugin: hook.plugin, hookId: hook.id, phase: "hook.exit", at: Date.now(), detail: { nextCalls, resultBytes } });
            return value;
        };
        try {
            const result = await invokeAt(0, rootEvent, skipHookIds);
            assertSchema(definition.resultSchema, result, `${eventName}.finalResult`);
            this.#emit({ dispatchId, event: eventName, origin, phase: "dispatch.end", at: Date.now() });
            return result;
        }
        catch (error) {
            this.#emit({ dispatchId, event: eventName, origin, phase: "dispatch.error", at: Date.now(), detail: error instanceof Error ? error.message : error });
            throw error;
        }
        finally {
            clearTimeout(timer);
            if (!controller.signal.aborted)
                controller.abort("dispatch-complete");
        }
    }
    #emit(record) {
        this.#trace?.(record);
    }
    async #buildBlueprint() {
        const hooks = [...this.#engineCreateHooks].sort((a, b) => a.pluginOrder - b.pluginOrder || a.hookOrder - b.hookOrder);
        const controller = new AbortController();
        const event = deepFreeze({ phase: "startup" });
        const emptyEngine = Object.freeze({});
        const invokeAt = async (index) => {
            if (index >= hooks.length)
                return emptyBlueprint();
            const hook = hooks[index];
            const next = (async (_forwarded) => invokeAt(index + 1));
            Object.defineProperties(next, {
                signal: { value: controller.signal, enumerable: true },
                event: { value: "engine.create", enumerable: true },
                origin: { value: "engine", enumerable: true },
                is: { value: (type) => type === "engine.create", enumerable: true },
            });
            Object.freeze(next);
            let observedBelow;
            const guardedNext = (async (forwarded) => {
                observedBelow = await next(forwarded);
                return observedBelow;
            });
            Object.defineProperties(guardedNext, {
                signal: { value: controller.signal, enumerable: true },
                event: { value: "engine.create", enumerable: true },
                origin: { value: "engine", enumerable: true },
                is: { value: (type) => type === "engine.create", enumerable: true },
            });
            Object.freeze(guardedNext);
            const result = await hook.callback(emptyEngine, event, guardedNext);
            const baseline = observedBelow ?? emptyBlueprint();
            validateBlueprintTransition(baseline, result);
            return result;
        };
        try {
            return await invokeAt(0);
        }
        finally {
            controller.abort("engine-created");
        }
    }
    #materializeEngine(blueprint) {
        const nouns = new Map();
        for (const name of blueprint.events.keys()) {
            const split = name.split(".");
            if (split.length !== 2 || !split[0] || !split[1])
                throw new Error(`Event ${name} must be in $.noun.event form.`);
            const [noun, event] = split;
            const table = nouns.get(noun) ?? {};
            if (Object.prototype.hasOwnProperty.call(table, event))
                throw new Error(`Duplicate engine method ${name}.`);
            table[event] = (input) => this.dispatch(name, input);
            nouns.set(noun, table);
        }
        const object = {};
        for (const [noun, table] of nouns)
            object[noun] = Object.freeze(table);
        return Object.freeze(object);
    }
}
export function bottom() {
    throw new BottomHookError("The bottom hook was invoked. No implementation exists beneath this continuation.");
}
//# sourceMappingURL=runtime.js.map