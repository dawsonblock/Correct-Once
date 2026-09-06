import type { NetworkRequestInput } from "@function-hooks/gateway";
import type { CapabilityRoute, RoutedActionRequest } from "./types.js";
type MaybePromise<T> = T | Promise<T>;
type RouteIdentity = {
    readonly app: string;
    readonly capability: string;
};
type Mapper<T> = (input: unknown, request: Readonly<RoutedActionRequest>) => MaybePromise<T>;
export interface McpCapabilityRouteOptions extends RouteIdentity {
    readonly server: string;
    readonly tool: string;
    readonly mapArgs?: Mapper<unknown>;
}
export declare function mcpCapabilityRoute(options: McpCapabilityRouteOptions): CapabilityRoute<"mcp.call">;
export interface ApiCapabilityRouteOptions extends RouteIdentity {
    readonly method?: string;
    readonly buildRequest: Mapper<Omit<NetworkRequestInput, "actionId" | "metadata" | "method"> & {
        readonly method?: string;
    }>;
}
export declare function apiCapabilityRoute(options: ApiCapabilityRouteOptions): CapabilityRoute<"network.request">;
export interface BrowserCapabilityRouteOptions extends RouteIdentity {
    readonly operation: string;
    readonly target?: string;
    readonly mapArgs?: Mapper<unknown>;
}
export declare function browserCapabilityRoute(options: BrowserCapabilityRouteOptions): CapabilityRoute<"browser.call">;
export interface DesktopCapabilityRouteOptions extends RouteIdentity {
    readonly application: string;
    readonly operation: string;
    readonly target?: string;
    readonly mapArgs?: Mapper<unknown>;
}
export declare function desktopCapabilityRoute(options: DesktopCapabilityRouteOptions): CapabilityRoute<"desktop.call">;
export interface ProcessCapabilityRouteOptions extends RouteIdentity {
    readonly profile: string;
    readonly mapArgs?: Mapper<readonly string[]>;
    readonly cwd?: string;
    readonly timeoutMs?: number;
}
export declare function processCapabilityRoute(options: ProcessCapabilityRouteOptions): CapabilityRoute<"process.exec">;
export interface FileReadCapabilityRouteOptions extends RouteIdentity {
    readonly path: Mapper<string>;
}
export declare function fileReadCapabilityRoute(options: FileReadCapabilityRouteOptions): CapabilityRoute<"fs.read">;
export interface FileWriteCapabilityRouteOptions extends RouteIdentity {
    readonly path: Mapper<string>;
    readonly data: Mapper<string>;
}
export declare function fileWriteCapabilityRoute(options: FileWriteCapabilityRouteOptions): CapabilityRoute<"fs.write">;
export {};
//# sourceMappingURL=routes.d.ts.map