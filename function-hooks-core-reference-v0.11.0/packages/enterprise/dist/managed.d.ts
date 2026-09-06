import type { RuntimeBudgetConfig } from "@function-hooks/assurance";
import type { EnterpriseRuntimePort } from "./policies.js";
export interface ManagedRuntimeOptions {
    readonly budgets?: RuntimeBudgetConfig;
}
import type { SealedManagedConfig } from "@function-hooks/assurance";
export declare function runtimeOptionsFromManagedConfig(sealed: SealedManagedConfig, publicKeyPem?: string): ManagedRuntimeOptions;
export declare function registerManagedEngineControls(runtime: EnterpriseRuntimePort, pluginOrder: number, sealed: SealedManagedConfig, publicKeyPem?: string): void;
//# sourceMappingURL=managed.d.ts.map