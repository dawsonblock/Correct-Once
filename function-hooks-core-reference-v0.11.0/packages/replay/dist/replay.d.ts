export interface ReplayNext {
    (event: unknown): Promise<unknown>;
    readonly event: string;
    readonly origin: string;
    readonly signal: AbortSignal;
}
export interface ReplayRegistrar {
    (event: string, callback: (engine: unknown, event: unknown, next: ReplayNext) => unknown | Promise<unknown>): void;
    (event: string, matcher: unknown, callback: (engine: unknown, event: unknown, next: ReplayNext) => unknown | Promise<unknown>): void;
}
export interface ReplayRuntimePort {
    registrar(plugin: string, order: number): ReplayRegistrar;
    dispatch(event: string, input: unknown, explicitOrigin?: string): Promise<unknown>;
}
export interface ReplayContext {
    readonly configHash?: string;
    readonly pluginSetHash?: string;
    readonly generationId?: string;
}
export interface ReplayRecord {
    readonly sequence: number;
    readonly at: number;
    readonly event: string;
    readonly origin: string;
    readonly input: unknown;
    readonly result?: unknown;
    readonly error?: string;
    readonly context: ReplayContext;
    readonly recordHash: string;
}
export declare class ReplayLog {
    #private;
    append(record: Omit<ReplayRecord, "sequence" | "recordHash">): ReplayRecord;
    records(): readonly ReplayRecord[];
    verify(): {
        readonly ok: true;
    } | {
        readonly ok: false;
        readonly index: number;
    };
}
export declare function registerReplayRecorder(runtime: ReplayRuntimePort, pluginOrder: number, log: ReplayLog, context?: ReplayContext, options?: {
    readonly events?: ReadonlySet<string>;
}): void;
/** Replay is intended for pure/mock adapters. It deliberately refuses recorded failures. */
export declare function replayAndVerify(runtime: ReplayRuntimePort, record: ReplayRecord): Promise<unknown>;
/** Stable-kernel recorder for explicit events. */
export declare function registerReplayHooks<M extends import("@function-hooks/core").EventMap>(builder: import("@function-hooks/core").KernelBuilder<M>, pluginOrder: number, events: readonly import("@function-hooks/core").EventName<M>[], log: ReplayLog, context?: ReplayContext): void;
export declare function replayKernelRecord<M extends import("@function-hooks/core").EventMap>(runtime: import("@function-hooks/core").Runtime<M>, record: ReplayRecord): Promise<unknown>;
//# sourceMappingURL=replay.d.ts.map