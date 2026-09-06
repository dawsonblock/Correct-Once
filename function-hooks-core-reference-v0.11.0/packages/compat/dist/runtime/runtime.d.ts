import { type RuntimeBudgetConfig } from "@function-hooks/assurance";
import type { EngineBlueprint, EngineCreateHook, EngineObject, RuntimeTraceRecord } from "./types.js";
export interface RuntimeOptions {
    readonly trace?: (record: RuntimeTraceRecord) => void;
    readonly budgets?: RuntimeBudgetConfig;
}
export interface OnRegistrar {
    (event: "engine.create", callback: EngineCreateHook): void;
    (event: string, callback: (...args: any[]) => unknown): void;
    (event: string, matcher: unknown, callback: (...args: any[]) => unknown): void;
}
/** @deprecated Compatibility runtime. New code should use createKernel() from @function-hooks/core. */
export declare class FunctionHooksRuntime {
    #private;
    constructor(options?: RuntimeOptions);
    registrar(plugin: string, pluginOrder: number): OnRegistrar;
    get engine(): EngineObject;
    get blueprint(): EngineBlueprint;
    start(): Promise<EngineObject>;
    dispatch(eventName: string, input: unknown, explicitOrigin?: string): Promise<unknown>;
}
export declare function bottom(): never;
//# sourceMappingURL=runtime.d.ts.map