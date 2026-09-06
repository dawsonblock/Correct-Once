import { type AdmittedCapability, type CapabilityRegistry } from "@function-hooks/capabilities";
import type { AnyCapabilityRoute, ExecutionRouter } from "./types.js";
export declare function compileAdmittedCapabilityRoute(value: AdmittedCapability): AnyCapabilityRoute;
export declare function compileActiveCapabilityRoutes(registry: CapabilityRegistry): Promise<readonly AnyCapabilityRoute[]>;
export interface CreateExecutionRouterFromRegistryOptions {
    readonly gateway: ExecutionRouter["gateway"];
    readonly registry: CapabilityRegistry;
    readonly manualRoutes?: readonly AnyCapabilityRoute[];
}
export declare function createExecutionRouterFromRegistry(options: CreateExecutionRouterFromRegistryOptions): Promise<ExecutionRouter>;
//# sourceMappingURL=capability-compiler.d.ts.map