export type MaybePromise<T> = T | Promise<T>;
export type EventMap = Record<string, {
    readonly input: unknown;
    readonly result: unknown;
}>;
export type EventName<M extends EventMap> = Extract<keyof M, string>;
export type EventInput<M extends EventMap, K extends EventName<M>> = M[K]["input"];
export type EventResult<M extends EventMap, K extends EventName<M>> = M[K]["result"];
export type DeepReadonly<T> = T extends (...args: never[]) => unknown ? T : T extends readonly (infer U)[] ? readonly DeepReadonly<U>[] : T extends object ? {
    readonly [K in keyof T]: DeepReadonly<T[K]>;
} : T;
export type Matcher<T> = T extends readonly (infer U)[] ? readonly Matcher<U>[] : T extends object ? {
    readonly [K in keyof T]?: Matcher<T[K]> | readonly Matcher<T[K]>[];
} : T | readonly T[];
export interface Engine<M extends EventMap> {
    readonly [noun: string]: Readonly<Record<string, (input: unknown) => Promise<unknown>>>;
}
export interface Next<M extends EventMap, K extends EventName<M>> {
    (event: EventInput<M, K>): Promise<EventResult<M, K>>;
    readonly signal: AbortSignal;
    readonly event: K;
    readonly origin: string;
    is<T extends EventName<M>>(type: T, event: unknown): event is DeepReadonly<EventInput<M, T>>;
}
export type Hook<M extends EventMap, K extends EventName<M>> = (engine: Engine<M>, event: DeepReadonly<EventInput<M, K>>, next: Next<M, K>) => MaybePromise<EventResult<M, K>>;
export interface EngineEvent<M extends EventMap, K extends EventName<M>> {
    readonly invoke: (input: DeepReadonly<EventInput<M, K>>, engine: Engine<M>) => MaybePromise<EventResult<M, K>>;
}
export interface EngineBlueprint<M extends EventMap> {
    readonly events: ReadonlyMap<EventName<M>, EngineEvent<M, any>>;
}
export interface DispatchOptions {
    /** Diagnostic caller label only. This is not an authentication or authorization identity. */
    readonly origin?: string;
    /** Cooperative cancellation. Aborting does not roll back work or side effects already started. */
    readonly signal?: AbortSignal;
    /** Optional per-dispatch deadline. Policy-level budgets belong above the kernel. */
    readonly timeoutMs?: number;
}
export type RuntimeState = "created" | "started" | "closed";
export interface Runtime<M extends EventMap> {
    readonly state: RuntimeState;
    start(): Promise<Engine<M>>;
    dispatch<K extends EventName<M>>(event: K, input: EventInput<M, K>, options?: DispatchOptions): Promise<EventResult<M, K>>;
    close(): Promise<void>;
}
export interface KernelBuilder<M extends EventMap> {
    on<K extends EventName<M>>(plugin: string, order: number, event: K, hook: Hook<M, K>): void;
    on<K extends EventName<M>>(plugin: string, order: number, event: K, matcher: Matcher<EventInput<M, K>>, hook: Hook<M, K>): void;
    defineEngine(blueprint: EngineBlueprint<M>): void;
    build(): Runtime<M>;
}
export interface RuntimeTraceRecord {
    readonly dispatchId: string;
    readonly event: string;
    readonly origin: string;
    readonly plugin?: string;
    readonly hookId?: string;
    readonly phase: "dispatch.start" | "hook.enter" | "hook.exit" | "base.enter" | "base.exit" | "dispatch.end" | "dispatch.error" | "dispatch.abort";
    readonly sequence: number;
    readonly detail?: Readonly<Record<string, unknown>>;
}
export interface KernelOptions<M extends EventMap> {
    readonly trace?: (record: RuntimeTraceRecord) => void;
    readonly defaultTimeoutMs?: number;
}
export interface HookDescriptor<M extends EventMap = EventMap> {
    readonly plugin: string;
    readonly order: number;
    readonly event: EventName<M>;
    readonly registrationIndex: number;
    readonly hasMatcher: boolean;
}
//# sourceMappingURL=types.d.ts.map