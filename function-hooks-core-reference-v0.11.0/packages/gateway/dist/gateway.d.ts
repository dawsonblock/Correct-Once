import { type KernelOptions } from "@function-hooks/core";
import { type ActionReceiptStore } from "@function-hooks/assurance";
import { type AgentGateway, type GatewayAdapters, type GatewayApprovalProvider, type GatewayAuditSink, type GatewayAuthorizer, type GatewayEventName, type GatewayEvents } from "./types.js";
export interface CreateAgentGatewayOptions extends KernelOptions<GatewayEvents> {
    readonly adapters: GatewayAdapters;
    /** Defaults to deny-all. Callers must deliberately install an authorization policy. */
    readonly authorizer?: GatewayAuthorizer;
    readonly approval?: GatewayApprovalProvider;
    readonly audit?: GatewayAuditSink;
    readonly receipts?: false | {
        readonly store?: ActionReceiptStore;
        readonly events?: readonly GatewayEventName[];
    };
}
export declare function createAgentGateway(options: CreateAgentGatewayOptions): Promise<AgentGateway>;
//# sourceMappingURL=gateway.d.ts.map