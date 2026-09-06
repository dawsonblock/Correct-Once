import type { ValueSchema } from "@function-hooks/assurance";

export type MaybePromise<T> = T | Promise<T>;

export interface EventSpec<Input = unknown, Result = unknown> {
  input: Input;
  result: Result;
}

export type EventMap = Record<string, EventSpec>;
export type EventName<M extends EventMap> = Extract<keyof M, string>;
export type EventInput<M extends EventMap, K extends EventName<M>> = M[K]["input"];
export type EventResult<M extends EventMap, K extends EventName<M>> = M[K]["result"];

export type DeepReadonly<T> =
  T extends (...args: never[]) => unknown ? T :
  T extends readonly (infer U)[] ? readonly DeepReadonly<U>[] :
  T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export type Matcher<T> =
  T extends readonly (infer U)[] ? readonly Matcher<U>[] :
  T extends object ? { readonly [K in keyof T]?: Matcher<T[K]> | readonly Matcher<T[K]>[] } :
  T | readonly T[];

export interface DispatchNext<M extends EventMap, K extends EventName<M>> {
  (event: EventInput<M, K>): Promise<EventResult<M, K>>;
  readonly signal: AbortSignal;
  readonly event: K;
  readonly origin: string;
  is<T extends EventName<M>>(type: T, event: unknown): event is DeepReadonly<EventInput<M, T>>;
}

export interface WildcardNext<M extends EventMap> {
  (event: unknown): Promise<unknown>;
  readonly signal: AbortSignal;
  readonly event: EventName<M> | string;
  readonly origin: string;
  is<T extends EventName<M>>(type: T, event: unknown): event is DeepReadonly<EventInput<M, T>>;
}

export type EngineObject = Readonly<Record<string, Readonly<Record<string, (input: unknown) => Promise<unknown>>>>>;

export type Hook<M extends EventMap, K extends EventName<M>> = (
  engine: EngineObject,
  event: DeepReadonly<EventInput<M, K>>,
  next: DispatchNext<M, K>,
) => MaybePromise<EventResult<M, K>>;

export type WildcardHook<M extends EventMap> = (
  engine: EngineObject,
  event: unknown,
  next: WildcardNext<M>,
) => MaybePromise<unknown>;

export interface EventBehavior {
  readonly sideEffect?: boolean;
  readonly idempotent?: boolean;
  readonly maxNextCalls?: number;
  readonly sensitivity?: "public" | "internal" | "secret";
}

export interface EventDefinition {
  readonly name: string;
  readonly owner: string;
  readonly schemaVersion?: string;
  readonly invoke: (input: unknown, engine: EngineObject) => MaybePromise<unknown>;
  readonly inputSchema?: ValueSchema;
  readonly resultSchema?: ValueSchema;
  readonly behavior?: EventBehavior;
}

export interface EventAddition {
  readonly invoke: EventDefinition["invoke"];
  readonly schemaVersion?: string;
  readonly inputSchema?: ValueSchema;
  readonly resultSchema?: ValueSchema;
  readonly behavior?: EventBehavior;
}

export interface EngineBlueprint {
  readonly events: ReadonlyMap<string, EventDefinition>;
}

export interface EngineCreateEvent {
  readonly phase: "startup";
}

export interface EngineCreateNext {
  (event: EngineCreateEvent): Promise<EngineBlueprint>;
  readonly signal: AbortSignal;
  readonly event: "engine.create";
  readonly origin: "engine";
  is(type: "engine.create", event: unknown): event is EngineCreateEvent;
}

export type EngineCreateHook = (
  engine: Readonly<Record<string, never>>,
  event: EngineCreateEvent,
  next: EngineCreateNext,
) => MaybePromise<EngineBlueprint>;

export interface HookRegistration {
  readonly id: string;
  readonly plugin: string;
  readonly pluginOrder: number;
  readonly hookOrder: number;
  readonly event: string | "*";
  readonly matcher?: unknown;
  readonly callback: (...args: any[]) => MaybePromise<unknown>;
}

export interface RuntimeTraceRecord {
  readonly dispatchId: string;
  readonly event: string;
  readonly origin: string;
  readonly plugin?: string;
  readonly hookId?: string;
  readonly phase: "dispatch.start" | "hook.enter" | "hook.exit" | "base.enter" | "base.exit" | "dispatch.end" | "dispatch.error" | "dispatch.abort";
  readonly at: number;
  readonly detail?: unknown;
}
