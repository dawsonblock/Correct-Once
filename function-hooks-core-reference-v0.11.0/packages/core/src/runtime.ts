import { AsyncLocalStorage } from "node:async_hooks";
import {
  BaseExecutionError,
  FunctionHooksError,
  DispatchCancelledError,
  DispatchTimeoutError,
  HookExecutionError,
  NextMultiplicityError,
  RuntimeClosedError,
  RuntimeStateError,
  UnknownEventError,
} from "./errors.js";
import { immutableEvent } from "./freeze.js";
import { substructuralMatch } from "./matcher.js";
import { snapshotBlueprint } from "./blueprint.js";
import type {
  DispatchOptions,
  Engine,
  EngineBlueprint,
  EventInput,
  EventMap,
  EventName,
  EventResult,
  Hook,
  HookDescriptor,
  KernelBuilder,
  KernelOptions,
  Matcher,
  Next,
  Runtime,
  RuntimeState,
  RuntimeTraceRecord,
} from "./types.js";

interface RegisteredHook<M extends EventMap> {
  readonly id: string;
  readonly plugin: string;
  readonly order: number;
  readonly registrationIndex: number;
  readonly event: EventName<M>;
  readonly matcher?: unknown;
  readonly callback: Hook<M, any>;
}

interface ExecutionContext {
  readonly skipHookIds: ReadonlySet<string>;
  readonly currentPlugin?: string;
}

type AbortKind = "caller" | "deadline" | "runtime-closed" | "complete";

function abortError(kind: AbortKind, eventName: string): Error {
  if (kind === "deadline") return new DispatchTimeoutError(`Dispatch ${eventName} exceeded its deadline.`);
  if (kind === "runtime-closed") return new RuntimeClosedError(`Runtime closed while ${eventName} was in flight.`);
  return new DispatchCancelledError(`Dispatch ${eventName} was cancelled.`);
}

function raceAbort<T>(work: Promise<T>, signal: AbortSignal, eventName: string): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal.reason as AbortKind, eventName));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError(signal.reason as AbortKind, eventName));
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

class KernelRuntime<M extends EventMap> implements Runtime<M> {
  readonly #hooks: readonly RegisteredHook<M>[];
  readonly #blueprint: EngineBlueprint<M>;
  readonly #trace: ((record: RuntimeTraceRecord) => void) | undefined;
  readonly #defaultTimeoutMs: number | undefined;
  readonly #als = new AsyncLocalStorage<ExecutionContext>();
  readonly #activeControllers = new Set<AbortController>();
  #state: RuntimeState = "created";
  #engine: Engine<M> | undefined;
  #dispatchCounter = 0;
  #traceSequence = 0;

  constructor(
    blueprint: EngineBlueprint<M>,
    hooks: readonly RegisteredHook<M>[],
    options: KernelOptions<M>,
  ) {
    this.#blueprint = blueprint;
    this.#hooks = [...hooks].sort((a, b) => a.order - b.order || a.registrationIndex - b.registrationIndex);
    this.#trace = options.trace;
    this.#defaultTimeoutMs = options.defaultTimeoutMs;
  }

  get state(): RuntimeState {
    return this.#state;
  }

  async start(): Promise<Engine<M>> {
    if (this.#state === "closed") throw new RuntimeClosedError("Cannot start a closed runtime.");
    if (this.#state === "started") return this.#engine!;
    this.#engine = this.#materializeEngine();
    this.#state = "started";
    return this.#engine;
  }

  async dispatch<K extends EventName<M>>(
    eventName: K,
    input: EventInput<M, K>,
    options: DispatchOptions = {},
  ): Promise<EventResult<M, K>> {
    if (this.#state === "closed") throw new RuntimeClosedError("Cannot dispatch on a closed runtime.");
    if (this.#state !== "started" || !this.#engine) {
      throw new RuntimeStateError("Runtime has not been started. Call start() before dispatch().");
    }
    const definition = this.#blueprint.events.get(eventName);
    if (!definition) throw new UnknownEventError(`Unknown event: ${eventName}`);

    const rootEvent = immutableEvent(input);
    const parent = this.#als.getStore();
    const origin = options.origin ?? parent?.currentPlugin ?? "engine";
    const skipHookIds = parent?.skipHookIds ?? new Set<string>();
    const timeoutMs = options.timeoutMs ?? this.#defaultTimeoutMs;
    if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
      throw new RangeError("timeoutMs must be a finite positive number.");
    }

    const dispatchId = `dispatch-${++this.#dispatchCounter}`;
    const controller = new AbortController();
    this.#activeControllers.add(controller);

    const callerSignal = options.signal;
    const onCallerAbort = (): void => {
      if (!controller.signal.aborted) controller.abort("caller" satisfies AbortKind);
    };
    if (callerSignal?.aborted) controller.abort("caller" satisfies AbortKind);
    else callerSignal?.addEventListener("abort", onCallerAbort, { once: true });

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        if (!controller.signal.aborted) {
          controller.abort("deadline" satisfies AbortKind);
          this.#emit({ dispatchId, event: eventName, origin, phase: "dispatch.abort", detail: { reason: "deadline", timeoutMs } });
        }
      }, timeoutMs);
    }

    this.#emit({ dispatchId, event: eventName, origin, phase: "dispatch.start" });

    const selected = this.#hooks.filter((hook) => hook.event === eventName && !skipHookIds.has(hook.id));

    const invokeAt = async (index: number, currentEvent: unknown, inheritedSkip: ReadonlySet<string>): Promise<unknown> => {
      if (controller.signal.aborted) throw abortError(controller.signal.reason as AbortKind, eventName);
      const frozenEvent = immutableEvent(currentEvent);
      let cursor = index;
      while (cursor < selected.length) {
        const candidate = selected[cursor]!;
        if (candidate.matcher === undefined || substructuralMatch(candidate.matcher, frozenEvent)) break;
        cursor += 1;
      }

      if (cursor >= selected.length) {
        this.#emit({ dispatchId, event: eventName, origin, phase: "base.enter" });
        try {
          const value = await raceAbort(Promise.resolve(this.#als.run(
            { skipHookIds: inheritedSkip },
            () => definition.invoke(frozenEvent as never, this.#engine!),
          )), controller.signal, eventName);
          this.#emit({ dispatchId, event: eventName, origin, phase: "base.exit" });
          return value;
        } catch (error) {
          if (error instanceof DispatchCancelledError || error instanceof RuntimeClosedError) throw error;
          throw new BaseExecutionError(`Base implementation for ${eventName} failed.`, { cause: normalizeError(error) });
        }
      }

      const hook = selected[cursor]!;
      const hookSkip = new Set(inheritedSkip);
      hookSkip.add(hook.id);
      let nextCalls = 0;
      const next = ((forwarded: unknown) => {
        nextCalls += 1;
        if (nextCalls > 1) {
          return Promise.reject(new NextMultiplicityError(`Hook ${hook.id} called next() more than once for ${eventName}.`));
        }
        return this.#als.run(
          { skipHookIds: inheritedSkip },
          () => invokeAt(cursor + 1, forwarded, inheritedSkip),
        );
      }) as Next<M, K>;
      Object.defineProperties(next, {
        signal: { value: controller.signal, enumerable: true },
        event: { value: eventName, enumerable: true },
        origin: { value: origin, enumerable: true },
        is: { value: (type: string, _candidate: unknown) => type === eventName, enumerable: true },
      });
      Object.freeze(next);

      this.#emit({ dispatchId, event: eventName, origin, plugin: hook.plugin, hookId: hook.id, phase: "hook.enter" });
      try {
        const value = await raceAbort(Promise.resolve(this.#als.run(
          { skipHookIds: hookSkip, currentPlugin: hook.plugin },
          () => hook.callback(this.#engine!, frozenEvent as never, next as never),
        )), controller.signal, eventName);
        this.#emit({ dispatchId, event: eventName, origin, plugin: hook.plugin, hookId: hook.id, phase: "hook.exit", detail: { nextCalls } });
        return value;
      } catch (error) {
        if (error instanceof FunctionHooksError) throw error;
        throw new HookExecutionError(`Hook ${hook.id} failed for ${eventName}.`, { cause: normalizeError(error) });
      }
    };

    try {
      const result = await invokeAt(0, rootEvent, skipHookIds) as EventResult<M, K>;
      this.#emit({ dispatchId, event: eventName, origin, phase: "dispatch.end" });
      return result;
    } catch (error) {
      this.#emit({ dispatchId, event: eventName, origin, phase: "dispatch.error", detail: { error: normalizeError(error).name } });
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
      this.#activeControllers.delete(controller);
      if (!controller.signal.aborted) controller.abort("complete" satisfies AbortKind);
    }
  }

  async close(): Promise<void> {
    if (this.#state === "closed") return;
    this.#state = "closed";
    for (const controller of this.#activeControllers) {
      if (!controller.signal.aborted) controller.abort("runtime-closed" satisfies AbortKind);
    }
    this.#activeControllers.clear();
    this.#engine = undefined;
  }

  #materializeEngine(): Engine<M> {
    const nouns = new Map<string, Record<string, (input: unknown) => Promise<unknown>>>();
    for (const name of this.#blueprint.events.keys()) {
      const [noun, verb] = name.split(".") as [string, string];
      const table = nouns.get(noun) ?? {};
      if (Object.prototype.hasOwnProperty.call(table, verb)) {
        throw new Error(`Duplicate engine method ${name}.`);
      }
      table[verb] = (input: unknown) => this.dispatch(name, input as never);
      nouns.set(noun, table);
    }
    const object: Record<string, Readonly<Record<string, (input: unknown) => Promise<unknown>>>> = {};
    for (const [noun, table] of nouns) object[noun] = Object.freeze(table);
    return Object.freeze(object) as Engine<M>;
  }

  #emit(record: Omit<RuntimeTraceRecord, "sequence">): void {
    const trace = this.#trace;
    if (!trace) return;
    const emitted = Object.freeze({ ...record, sequence: ++this.#traceSequence });
    // Trace observers are explicitly observational. A broken telemetry sink must
    // never change dispatch success, failure, ordering, cancellation, or lifecycle.
    try { trace(emitted); } catch { /* observational callback failures are isolated */ }
  }
}

class Builder<M extends EventMap> implements KernelBuilder<M> {
  readonly #options: KernelOptions<M>;
  readonly #hooks: RegisteredHook<M>[] = [];
  #blueprint: EngineBlueprint<M> | undefined;
  #built = false;
  #registrationIndex = 0;

  constructor(options: KernelOptions<M>) {
    this.#options = options;
  }

  on<K extends EventName<M>>(
    plugin: string,
    order: number,
    event: K,
    matcherOrHook: Matcher<EventInput<M, K>> | Hook<M, K>,
    maybeHook?: Hook<M, K>,
  ): void {
    this.#assertMutable();
    if (!plugin.trim()) throw new TypeError("plugin must be a non-empty string.");
    if (!Number.isFinite(order)) throw new TypeError("order must be a finite number.");
    const callback = (maybeHook ?? matcherOrHook) as Hook<M, K>;
    const matcher = maybeHook === undefined ? undefined : matcherOrHook;
    if (typeof callback !== "function") throw new TypeError(`Hook callback for ${event} must be a function.`);
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

  defineEngine(blueprint: EngineBlueprint<M>): void {
    this.#assertMutable();
    if (this.#blueprint) throw new RuntimeStateError("Engine blueprint has already been defined.");
    this.#blueprint = snapshotBlueprint(blueprint);
  }

  build(): Runtime<M> {
    this.#assertMutable();
    if (!this.#blueprint) throw new RuntimeStateError("defineEngine() must be called before build().");
    this.#built = true;
    return new KernelRuntime(this.#blueprint, this.#hooks, this.#options);
  }

  #assertMutable(): void {
    if (this.#built) throw new RuntimeStateError("KernelBuilder is immutable after build().");
  }
}

export function createKernel<M extends EventMap>(options: KernelOptions<M> = {}): KernelBuilder<M> {
  return new Builder<M>(options);
}

export function describeHooks<M extends EventMap>(builder: KernelBuilder<M>): readonly HookDescriptor<M>[] {
  void builder;
  // Introspection is deliberately not part of the stable builder contract in 0.4.
  return Object.freeze([]);
}
