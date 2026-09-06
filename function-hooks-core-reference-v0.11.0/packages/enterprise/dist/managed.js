import { verifyManagedConfig } from "@function-hooks/assurance";
import { registerBlastDoorPlugin } from "./policies.js";
export function runtimeOptionsFromManagedConfig(sealed, publicKeyPem) {
    verifyManagedConfig(sealed, publicKeyPem);
    return Object.freeze({ ...(sealed.config.budgets ? { budgets: sealed.config.budgets } : {}) });
}
export function registerManagedEngineControls(runtime, pluginOrder, sealed, publicKeyPem) {
    verifyManagedConfig(sealed, publicKeyPem);
    if (sealed.config.allowedEvents)
        registerBlastDoorPlugin(runtime, pluginOrder, new Set(sealed.config.allowedEvents));
}
//# sourceMappingURL=managed.js.map