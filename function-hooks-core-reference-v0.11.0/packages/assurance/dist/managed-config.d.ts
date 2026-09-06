import type { RuntimeBudgetConfig } from "./budgets.js";
export interface ManagedPluginPin {
    readonly name: string;
    readonly digest: string;
}
export interface ManagedRuntimeConfig {
    readonly format: "function-hooks-managed-config/v1";
    readonly generatedAt?: string;
    readonly prepend?: readonly string[];
    readonly append?: readonly string[];
    readonly plugins: readonly ManagedPluginPin[];
    readonly allowedEvents?: readonly string[];
    readonly budgets?: RuntimeBudgetConfig;
}
export interface SealedManagedConfig {
    readonly config: ManagedRuntimeConfig;
    readonly sha256: string;
    readonly signature?: string;
    readonly algorithm?: "Ed25519";
}
export declare function sealManagedConfig(config: ManagedRuntimeConfig, privateKeyPem?: string): SealedManagedConfig;
export declare function verifyManagedConfig(sealed: SealedManagedConfig, publicKeyPem?: string): void;
//# sourceMappingURL=managed-config.d.ts.map