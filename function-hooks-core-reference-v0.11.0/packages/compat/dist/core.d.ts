import type { EngineObject } from "./runtime/types.js";
import type { FunctionHooksRuntime } from "./runtime/runtime.js";
export interface ToolCallInput {
    readonly tool: string;
    readonly command?: string;
    readonly args?: unknown;
    readonly timeout?: number;
}
export type ToolCallResult = {
    readonly ok: true;
    readonly value: unknown;
} | {
    readonly deny: string;
};
export interface CoreAdapters {
    readonly toolCall?: (input: ToolCallInput, engine: EngineObject) => unknown | Promise<unknown>;
    readonly promptSubmit?: (input: {
        readonly text: string;
    }, engine: EngineObject) => unknown | Promise<unknown>;
    readonly fsRead?: (input: {
        readonly path: string;
    }, engine: EngineObject) => unknown | Promise<unknown>;
    readonly fsWrite?: (input: {
        readonly path: string;
        readonly data: string;
    }, engine: EngineObject) => unknown | Promise<unknown>;
    readonly networkFetch?: (input: {
        readonly url: string;
        readonly init?: unknown;
    }, engine: EngineObject) => unknown | Promise<unknown>;
    readonly modelCall?: (input: {
        readonly model: string;
        readonly messages: readonly unknown[];
    }, engine: EngineObject) => unknown | Promise<unknown>;
    readonly terminalExec?: (input: {
        readonly command: string;
        readonly timeout?: number;
    }, engine: EngineObject) => unknown | Promise<unknown>;
    readonly permissionsCheck?: (input: {
        readonly capability: string;
        readonly resource?: string;
    }, engine: EngineObject) => unknown | Promise<unknown>;
    readonly uiRender?: (input: {
        readonly component: string;
        readonly props: unknown;
        readonly surface: string;
    }, engine: EngineObject) => unknown | Promise<unknown>;
    readonly uiResolve?: (input: {
        readonly surface: string;
    }, engine: EngineObject) => unknown | Promise<unknown>;
    readonly uiLog?: (input: {
        readonly message: string;
    }, engine: EngineObject) => unknown | Promise<unknown>;
}
/** @deprecated Standard events moved to @function-hooks/events. */
export declare function registerCorePlugin(runtime: FunctionHooksRuntime, pluginOrder: number, adapters?: CoreAdapters): void;
//# sourceMappingURL=core.d.ts.map