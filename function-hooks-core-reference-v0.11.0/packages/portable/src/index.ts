import type {
  DeepReadonly,
  DispatchOptions,
  Engine,
  EngineBlueprint,
  EventInput,
  EventMap,
  EventName,
  EventResult,
  Hook,
  KernelBuilder,
  KernelOptions,
  Matcher,
  Next,
  Runtime,
  RuntimeState,
  RuntimeTraceRecord,
} from "@function-hooks/core";

class PortableKernelError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}
class RuntimeStateError extends PortableKernelError {}
class RuntimeClosedError extends RuntimeStateError {}
class UnknownEventError extends PortableKernelError {}
class UnsupportedEventValueError extends PortableKernelError {}
class NextMultiplicityError extends PortableKernelError {}
class DispatchCancelledError extends PortableKernelError {}
class DispatchTimeoutError extends DispatchCancelledError {}
class HookExecutionError extends PortableKernelError {}
class BaseExecutionError extends PortableKernelError {}

type AbortKind = "caller" | "deadline" | "runtime-closed" | "complete";

interface RegisteredHook<M extends EventMap> {
  readonly id: string;
  readonly plugin: string;
  readonly order: number;
  readonly registrationIndex: number;
  readonly event: EventName<M>;
  readonly matcher?: unknown;
  readonly callback: Hook<M, any>;
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

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
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error) => { signal.removeEventListener("abort", onAbort); reject(error); },
    );
  });
}

function assertPlainValue(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const child of value) assertPlainValue(child, seen);
    return;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    const name = proto?.constructor?.name ?? "unknown";
    throw new UnsupportedEventValueError(`Event values must contain only primitives, arrays, and plain objects; received ${name}.`);
  }
  for (const key of Reflect.ownKeys(value)) {
    assertPlainValue((value as Record<PropertyKey, unknown>)[key], seen);
  }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const key of Reflect.ownKeys(object)) deepFreeze((object as Record<PropertyKey, unknown>)[key], seen);
  return Object.freeze(value);
}

function immutableEvent<T>(value: T): T {
  let clone: T;
  try {
    clone = structuredClone(value);
  } catch (error) {
    throw new UnsupportedEventValueError("Event value is not structured-cloneable.", { cause: normalizeError(error) });
  }
  assertPlainValue(clone);
  return deepFreeze(clone);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function substructuralMatch(pattern: unknown, value: unknown): boolean {
  if (Array.isArray(pattern)) return pattern.length > 0 && pattern.some((candidate) => substructuralMatch(candidate, value));
  if (isPlainObject(pattern)) {
    if (!isPlainObject(value)) return false;
    return Object.entries(pattern).every(([key, child]) =>
      Object.prototype.hasOwnProperty.call(value, key) && substructuralMatch(child, value[key]),
    );
  }
  return Object.is(pattern, value);
}

function snapshotBlueprint<M extends EventMap>(blueprint: EngineBlueprint<M>): EngineBlueprint<M> {
  if (!blueprint || !(blueprint.events instanceof Map)) throw new TypeError("Engine blueprint must expose an events Map.");
  return Object.freeze({ events: new Map(blueprint.events) });
}

class PortableRuntime<M extends EventMap> implements Runtime<M> {
  readonly #blueprint: EngineBlueprint<M>;
  readonly #hooks: readonly RegisteredHook<M>[];
  readonly #trace: ((record: RuntimeTraceRecord) => void) | undefined;
  readonly #defaultTimeoutMs: number | undefined;
  readonly #activeControllers = new Set<AbortController>();
  #state: RuntimeState = "created";
  #engine: Engine<M> | undefined;
  #dispatchCounter = 0;
  #traceSequence = 0;

  constructor(blueprint: EngineBlueprint<M>, hooks: readonly RegisteredHook<M>[], options: KernelOptions<M>) {
    this.#blueprint = blueprint;
    this.#hooks = [...hooks].sort((a, b) => a.order - b.order || a.registrationIndex - b.registrationIndex);
    this.#trace = options.trace;
    this.#defaultTimeoutMs = options.defaultTimeoutMs;
  }

  get state(): RuntimeState { return this.#state; }

  async start(): Promise<Engine<M>> {
    if (this.#state === "closed") throw new RuntimeClosedError("Cannot start a closed runtime.");
    if (this.#state === "started") return this.#engine!;
    this.#engine = this.#materializeEngine(new Set());
    this.#state = "started";
    return this.#engine;
  }

  dispatch<K extends EventName<M>>(event: K, input: EventInput<M, K>, options: DispatchOptions = {}): Promise<EventResult<M, K>> {
    return this.#dispatchInternal(event, input, options, new Set());
  }

  async #dispatchInternal<K extends EventName<M>>(
    eventName: K,
    input: EventInput<M, K>,
    options: DispatchOptions,
    inheritedSkip: ReadonlySet<string>,
  ): Promise<EventResult<M, K>> {
    if (this.#state === "closed") throw new RuntimeClosedError("Cannot dispatch on a closed runtime.");
    if (this.#state !== "started" || !this.#engine) throw new RuntimeStateError("Runtime has not been started. Call start() before dispatch().");
    const definition = this.#blueprint.events.get(eventName);
    if (!definition) throw new UnknownEventError(`Unknown event: ${eventName}`);

    const rootEvent = immutableEvent(input);
    const origin = options.origin ?? "engine";
    const timeoutMs = options.timeoutMs ?? this.#defaultTimeoutMs;
    if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) throw new RangeError("timeoutMs must be a finite positive number.");

    const dispatchId = `portable-${++this.#dispatchCounter}`;
    const controller = new AbortController();
    this.#activeControllers.add(controller);
    const callerSignal = options.signal;
    const onCallerAbort = (): void => { if (!controller.signal.aborted) controller.abort("caller" satisfies AbortKind); };
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
    const selected = this.#hooks.filter((hook) => hook.event === eventName && !inheritedSkip.has(hook.id));

    const invokeAt = async (index: number, currentEvent: unknown, skip: ReadonlySet<string>): Promise<unknown> => {
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
        const baseEngine = this.#materializeEngine(skip);
        try {
          const value = await raceAbort(Promise.resolve(definition.invoke(frozenEvent as never, baseEngine)), controller.signal, eventName);
          this.#emit({ dispatchId, event: eventName, origin, phase: "base.exit" });
          return value;
        } catch (error) {
          if (error instanceof DispatchCancelledError || error instanceof RuntimeClosedError) throw error;
          throw new BaseExecutionError(`Base implementation for ${eventName} failed.`, { cause: normalizeError(error) });
        }
      }

      const hook = selected[cursor]!;
      const hookSkip = new Set(skip); hookSkip.add(hook.id);
      let nextCalls = 0;
      const next = ((forwarded: unknown) => {
        nextCalls += 1;
        if (nextCalls > 1) return Promise.reject(new NextMultiplicityError(`Hook ${hook.id} called next() more than once for ${eventName}.`));
        return invokeAt(cursor + 1, forwarded, skip);
      }) as Next<M, K>;
      Object.defineProperties(next, {
        signal: { value: controller.signal, enumerable: true },
        event: { value: eventName, enumerable: true },
        origin: { value: origin, enumerable: true },
        is: { value: (type: string, _candidate: unknown) => type === eventName, enumerable: true },
      });
      Object.freeze(next);

      const hookEngine = this.#materializeEngine(hookSkip);
      this.#emit({ dispatchId, event: eventName, origin, plugin: hook.plugin, hookId: hook.id, phase: "hook.enter" });
      try {
        const value = await raceAbort(Promise.resolve(hook.callback(hookEngine, frozenEvent as never, next as never)), controller.signal, eventName);
        this.#emit({ dispatchId, event: eventName, origin, plugin: hook.plugin, hookId: hook.id, phase: "hook.exit", detail: { nextCalls } });
        return value;
      } catch (error) {
        if (error instanceof PortableKernelError) throw error;
        throw new HookExecutionError(`Hook ${hook.id} failed for ${eventName}.`, { cause: normalizeError(error) });
      }
    };

    try {
      const result = await invokeAt(0, rootEvent, inheritedSkip) as EventResult<M, K>;
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
    for (const controller of this.#activeControllers) if (!controller.signal.aborted) controller.abort("runtime-closed" satisfies AbortKind);
    this.#activeControllers.clear();
    this.#engine = undefined;
  }

  #materializeEngine(skip: ReadonlySet<string>): Engine<M> {
    const nouns = new Map<string, Record<string, (input: unknown) => Promise<unknown>>>();
    for (const name of this.#blueprint.events.keys()) {
      const parts = name.split(".");
      if (parts.length !== 2 || !parts[0] || !parts[1]) throw new TypeError(`Invalid engine event name: ${name}`);
      const [noun, verb] = parts as [string, string];
      const table = nouns.get(noun) ?? {};
      if (Object.prototype.hasOwnProperty.call(table, verb)) throw new TypeError(`Duplicate engine method ${name}.`);
      table[verb] = (input: unknown) => this.#dispatchInternal(name, input as never, {}, skip);
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

class PortableBuilder<M extends EventMap> implements KernelBuilder<M> {
  readonly #options: KernelOptions<M>;
  readonly #hooks: RegisteredHook<M>[] = [];
  #blueprint: EngineBlueprint<M> | undefined;
  #built = false;
  #registrationIndex = 0;

  constructor(options: KernelOptions<M>) { this.#options = options; }

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
    this.#hooks.push({ id: `${plugin}:${registrationIndex}:${event}`, plugin, order, registrationIndex, event, ...(matcher === undefined ? {} : { matcher }), callback });
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
    return new PortableRuntime(this.#blueprint, this.#hooks, this.#options);
  }

  #assertMutable(): void { if (this.#built) throw new RuntimeStateError("KernelBuilder is immutable after build()."); }
}

/**
 * Independent kernel implementation. Only public TypeScript contracts are
 * imported from @function-hooks/core; no reference-runtime code is reused.
 */
export function createPortableKernel<M extends EventMap>(options: KernelOptions<M> = {}): KernelBuilder<M> {
  return new PortableBuilder<M>(options);
}
