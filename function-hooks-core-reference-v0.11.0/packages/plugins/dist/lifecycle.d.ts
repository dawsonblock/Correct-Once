export type EngineObject = Readonly<Record<string, Readonly<Record<string, (input: unknown) => Promise<unknown>>>>>;
export interface StartableRuntime {
    start(): Promise<EngineObject>;
    close?(): void | Promise<void>;
}
export interface RuntimeGeneration {
    readonly id: string;
    readonly runtime: StartableRuntime;
    readonly engine: EngineObject;
    readonly createdAt: number;
    readonly metadata?: Readonly<Record<string, unknown>>;
    readonly close?: () => void | Promise<void>;
}
export interface GenerationLease {
    readonly generation: RuntimeGeneration;
    release(): Promise<void>;
}
export interface ActivationReceipt {
    readonly activationId: string;
    readonly at: number;
    readonly fromGeneration?: string;
    readonly toGeneration: string;
    readonly metadataHash: string;
    readonly healthChecks: readonly string[];
}
export interface ActivationReceiptSink {
    append(receipt: ActivationReceipt): void | Promise<void>;
}
export declare class FileActivationReceiptSink implements ActivationReceiptSink {
    #private;
    constructor(path: string, options?: {
        readonly sync?: boolean;
    });
    append(receipt: ActivationReceipt): Promise<void>;
}
export declare class RuntimeGenerationManager {
    #private;
    constructor(options?: {
        readonly receiptSink?: ActivationReceiptSink;
    });
    current(): RuntimeGeneration | undefined;
    activate(build: () => Promise<Omit<RuntimeGeneration, "id" | "createdAt" | "engine"> & {
        readonly id?: string;
        readonly engine?: EngineObject;
    }>, healthChecks?: Readonly<Record<string, (generation: RuntimeGeneration) => boolean | Promise<boolean>>>): Promise<ActivationReceipt>;
    acquire(): GenerationLease;
    close(): Promise<void>;
}
//# sourceMappingURL=lifecycle.d.ts.map