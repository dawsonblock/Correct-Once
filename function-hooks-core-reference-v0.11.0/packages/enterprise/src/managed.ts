import type { RuntimeBudgetConfig } from "@function-hooks/assurance";
import type { EnterpriseRuntimePort } from "./policies.js";
export interface ManagedRuntimeOptions { readonly budgets?: RuntimeBudgetConfig; }
import type { SealedManagedConfig } from "@function-hooks/assurance";
import { verifyManagedConfig } from "@function-hooks/assurance";
import { registerBlastDoorPlugin } from "./policies.js";

export function runtimeOptionsFromManagedConfig(sealed: SealedManagedConfig, publicKeyPem?: string): ManagedRuntimeOptions {
  verifyManagedConfig(sealed, publicKeyPem);
  return Object.freeze({ ...(sealed.config.budgets ? { budgets: sealed.config.budgets } : {}) });
}

export function registerManagedEngineControls(
  runtime: EnterpriseRuntimePort,
  pluginOrder: number,
  sealed: SealedManagedConfig,
  publicKeyPem?: string,
): void {
  verifyManagedConfig(sealed, publicKeyPem);
  if (sealed.config.allowedEvents) registerBlastDoorPlugin(runtime, pluginOrder, new Set(sealed.config.allowedEvents));
}
