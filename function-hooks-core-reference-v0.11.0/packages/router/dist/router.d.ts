import type { AnyCapabilityRoute, ExecutionRouter } from "./types.js";
export interface CreateExecutionRouterOptions {
    readonly gateway: ExecutionRouter["gateway"];
    readonly routes: readonly AnyCapabilityRoute[];
}
export declare function createExecutionRouter(options: CreateExecutionRouterOptions): ExecutionRouter;
//# sourceMappingURL=router.d.ts.map