import type { HashChainAuditLedger } from "@function-hooks/audit";
import type { RuntimeTraceRecord, EventMap, EventName, EngineBlueprint, KernelBuilder } from "@function-hooks/core";
export interface EnterpriseNext {
    (event: unknown): Promise<unknown>;
    readonly event: string;
    readonly origin: string;
    readonly signal: AbortSignal;
}
export interface EnterpriseRegistrar {
    (event: string, callback: (engine: unknown, event: unknown, next: EnterpriseNext) => unknown | Promise<unknown>): void;
    (event: string, matcher: unknown, callback: (engine: unknown, event: unknown, next: EnterpriseNext) => unknown | Promise<unknown>): void;
}
export interface EnterpriseRuntimePort {
    registrar(plugin: string, order: number): EnterpriseRegistrar;
}
export declare function registerAuditPlugin(runtime: EnterpriseRuntimePort, pluginOrder: number, sink: (record: {
    origin: string;
    event: string;
    at: number;
    input: unknown;
    result?: unknown;
    error?: string;
}) => void | Promise<void>): void;
export declare function registerHashChainAuditPlugin(runtime: EnterpriseRuntimePort, pluginOrder: number, ledger: HashChainAuditLedger): void;
export declare function registerBlastDoorPlugin(runtime: EnterpriseRuntimePort, pluginOrder: number, allowedEvents: ReadonlySet<string>): void;
export declare function registerOriginAllowlistPlugin(runtime: EnterpriseRuntimePort, pluginOrder: number, rules: Readonly<Record<string, readonly string[]>>): void;
export declare function collectTrace(records: RuntimeTraceRecord[]): (record: RuntimeTraceRecord) => void;
/** Stable-kernel blast door: filter a blueprint before defineEngine(). */
export declare function applyBlastDoor<M extends EventMap>(blueprint: EngineBlueprint<M>, allowedEvents: ReadonlySet<EventName<M>>): EngineBlueprint<M>;
/** Stable-kernel origin policy for explicit rules. Kernel origins remain diagnostic labels, not authenticated identities. */
export declare function registerOriginAllowlistHooks<M extends EventMap>(builder: KernelBuilder<M>, pluginOrder: number, rules: Partial<Record<EventName<M>, readonly string[]>>): void;
//# sourceMappingURL=policies.d.ts.map