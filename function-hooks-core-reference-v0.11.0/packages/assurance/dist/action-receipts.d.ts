export interface ReceiptNext {
    (event: unknown): Promise<unknown>;
    readonly event: string;
    readonly origin: string;
    readonly signal: AbortSignal;
}
export interface ReceiptRegistrar {
    (event: string, callback: (engine: unknown, event: unknown, next: ReceiptNext) => unknown | Promise<unknown>): void;
    (event: string, matcher: unknown, callback: (engine: unknown, event: unknown, next: ReceiptNext) => unknown | Promise<unknown>): void;
}
export interface ReceiptRuntimePort {
    registrar(plugin: string, order: number): ReceiptRegistrar;
}
export type ActionReceiptState = "started" | "completed" | "indeterminate";
export interface ActionReceipt {
    readonly actionId: string;
    readonly event: string;
    readonly inputHash: string;
    readonly state: ActionReceiptState;
    readonly startedAt: number;
    readonly completedAt?: number;
    readonly result?: unknown;
    readonly resultHash?: string;
    readonly error?: string;
}
export interface ActionReceiptStore {
    get(actionId: string): Promise<ActionReceipt | undefined>;
    begin(actionId: string, event: string, input: unknown): Promise<{
        readonly created: true;
        readonly receipt: ActionReceipt;
    } | {
        readonly created: false;
        readonly receipt: ActionReceipt;
    }>;
    complete(actionId: string, result: unknown): Promise<ActionReceipt>;
    markIndeterminate(actionId: string, error?: string): Promise<ActionReceipt>;
}
export declare class InMemoryActionReceiptStore implements ActionReceiptStore {
    #private;
    get(actionId: string): Promise<ActionReceipt | undefined>;
    begin(actionId: string, event: string, input: unknown): Promise<{
        readonly created: true;
        readonly receipt: ActionReceipt;
    } | {
        readonly created: false;
        readonly receipt: ActionReceipt;
    }>;
    complete(actionId: string, result: unknown): Promise<ActionReceipt>;
    markIndeterminate(actionId: string, error?: string): Promise<ActionReceipt>;
}
export interface FileActionReceiptStoreOptions {
    readonly sync?: "always" | "none";
    readonly recoverTrailingPartial?: boolean;
    /** Cross-process coordination using a crash-recoverable exclusive lock file. Defaults to true. */
    readonly crossProcessLock?: boolean;
    readonly lockTimeoutMs?: number;
    readonly lockStaleMs?: number;
}
export declare class FileActionReceiptStore implements ActionReceiptStore {
    #private;
    private constructor();
    static open(path: string, options?: FileActionReceiptStoreOptions): Promise<FileActionReceiptStore>;
    get(actionId: string): Promise<ActionReceipt | undefined>;
    begin(actionId: string, event: string, input: unknown): Promise<{
        readonly created: true;
        readonly receipt: ActionReceipt;
    } | {
        readonly created: false;
        readonly receipt: ActionReceipt;
    }>;
    complete(actionId: string, result: unknown): Promise<ActionReceipt>;
    markIndeterminate(actionId: string, error?: string): Promise<ActionReceipt>;
}
export interface ActionReceiptPluginOptions {
    readonly events: ReadonlySet<string>;
    readonly actionId?: (event: string, input: unknown) => string | undefined;
}
/**
 * Adds retry-safe exactly-once-or-detect semantics to selected side-effect events.
 * Completed receipts are replayed without re-executing the lower chain. A failure
 * after durable begin but before durable completion becomes indeterminate and fails closed.
 */
export declare function registerActionReceiptPlugin(runtime: ReceiptRuntimePort, pluginOrder: number, store: ActionReceiptStore, options: ActionReceiptPluginOptions): void;
/** Stable-kernel adapter: registers receipt protection on explicit event names. */
export declare function registerActionReceiptHooks<M extends import("@function-hooks/core").EventMap>(builder: import("@function-hooks/core").KernelBuilder<M>, pluginOrder: number, store: ActionReceiptStore, options: ActionReceiptPluginOptions): void;
//# sourceMappingURL=action-receipts.d.ts.map