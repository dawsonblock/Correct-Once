import type { EventMap, KernelBuilder, KernelOptions, RuntimeTraceRecord } from "./types.js";
export interface GoldenTraceRow {
    readonly phase: RuntimeTraceRecord["phase"];
    readonly plugin?: string;
}
export declare const THREE_HOOK_GOLDEN_TRACE: readonly GoldenTraceRow[];
/** A runtime implementation claiming compatibility can supply this factory. */
export type ConformanceKernelFactory = <M extends EventMap>(options?: KernelOptions<M>) => KernelBuilder<M>;
export interface ConformanceCaseResult {
    readonly name: string;
    readonly passed: boolean;
    readonly durationMs: number;
    readonly error?: Readonly<{
        name: string;
        message: string;
    }>;
}
export declare const KERNEL_SEMANTICS_VERSION: "1.0-rc.1";
export interface ConformanceReport {
    readonly semanticsVersion: typeof KERNEL_SEMANTICS_VERSION;
    readonly passed: number;
    readonly failed: number;
    readonly total: number;
    readonly cases: readonly ConformanceCaseResult[];
}
export declare const KERNEL_CONFORMANCE_CASE_NAMES: readonly string[];
export declare const KERNEL_CONFORMANCE_CASE_COUNT: number;
/**
 * Execute the observable kernel contract against any implementation exposing the
 * public KernelBuilder/Runtime shape. The harness compares semantic error names
 * instead of constructor identity so separately packaged implementations can be
 * qualified without sharing internal classes.
 */
export declare function runKernelConformance(factory: ConformanceKernelFactory): Promise<ConformanceReport>;
//# sourceMappingURL=conformance.d.ts.map