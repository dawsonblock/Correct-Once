import type { KernelBuilder } from "@function-hooks/core";
import { type GatewayApprovalProvider, type GatewayAuditSink, type GatewayAuthorizer, type GatewayEventName, type GatewayEvents } from "./types.js";
export declare function denyAllGatewayAuthorizer(reason?: string): GatewayAuthorizer;
export declare function allowAllGatewayAuthorizer(): GatewayAuthorizer;
export interface GatewayAllowlistPolicy {
    readonly events: readonly GatewayEventName[];
    /** Diagnostic kernel-origin labels only; this is not an authentication boundary. */
    readonly origins?: Partial<Record<GatewayEventName, readonly string[]>>;
    readonly processProfiles?: readonly string[];
    /** @deprecated Raw command policy is only relevant when the host explicitly enables legacy raw command execution. */
    readonly processCommands?: readonly string[];
    readonly networkOrigins?: readonly string[];
    readonly mcpTools?: Readonly<Record<string, readonly string[]>>;
    readonly browserOperations?: readonly string[];
    /** Desktop operations are allowlisted per host application identifier. */
    readonly desktopOperations?: Readonly<Record<string, readonly string[]>>;
    readonly requireApprovalFor?: readonly GatewayEventName[];
}
export declare function createGatewayAllowlistAuthorizer(policy: GatewayAllowlistPolicy): GatewayAuthorizer;
export declare function registerGatewayPolicyHooks(builder: KernelBuilder<GatewayEvents>, order: number, authorizer: GatewayAuthorizer, approval: GatewayApprovalProvider | undefined, audit?: GatewayAuditSink): void;
//# sourceMappingURL=policy.d.ts.map