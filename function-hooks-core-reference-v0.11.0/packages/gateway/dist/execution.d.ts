import type { KernelBuilder } from "@function-hooks/core";
import { type GatewayAdapters, type GatewayAuditSink, type GatewayEvents } from "./types.js";
export declare function registerGatewayExecutionAuditHooks(builder: KernelBuilder<GatewayEvents>, order: number, audit?: GatewayAuditSink): void;
export declare function registerGatewayExecutionHooks(builder: KernelBuilder<GatewayEvents>, order: number, adapters: GatewayAdapters): void;
//# sourceMappingURL=execution.d.ts.map