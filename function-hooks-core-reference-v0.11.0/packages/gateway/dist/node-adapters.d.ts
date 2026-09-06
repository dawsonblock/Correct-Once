import type { BrowserCallInput, DesktopCallInput, GatewayAdapterContext, GatewayAdapters, McpCallInput } from "./types.js";
export interface ProcessProfile {
    readonly id: string;
    readonly executable: string;
    /** Optional lowercase/uppercase hex SHA-256 pin for the executable. */
    readonly executableSha256?: string;
    /** Host-owned arguments prepended before caller-supplied args. */
    readonly fixedArgs?: readonly string[];
    /** Caller arguments are rejected unless this returns true. Omit to allow no caller arguments. */
    readonly validateArgs?: (args: readonly string[]) => boolean;
    /** Optional working-directory root, relative to fsRoot or absolute within fsRoot. */
    readonly cwdRoot?: string;
    /** Explicit child environment. The parent process environment is never inherited. */
    readonly environment?: Readonly<Record<string, string>>;
    readonly maxTimeoutMs?: number;
    readonly maxOutputBytes?: number;
}
type FilesystemSecurityMode = "auto" | "required" | "legacy";
type ProcessTreeIsolation = "process-group" | "direct";
export interface NodeGatewayAdapterOptions {
    readonly fsRoot: string;
    readonly processProfiles?: readonly ProcessProfile[];
    /** @deprecated Use processProfiles. Ignored unless allowLegacyProcessCommands is explicitly true. */
    readonly processCommands?: readonly string[];
    /** Explicit insecure compatibility escape hatch. Defaults to false. */
    readonly allowLegacyProcessCommands?: boolean;
    /** @deprecated Legacy raw-command environment only. Parent environment is never inherited. */
    readonly processEnvironment?: Readonly<Record<string, string>>;
    readonly maxProcessTimeoutMs?: number;
    readonly maxOutputBytes?: number;
    /** Descendant termination policy. process-group is the secure default. */
    readonly processTreeIsolation?: ProcessTreeIsolation;
    readonly processKillGraceMs?: number;
    /** auto uses descriptor-anchored Linux I/O when available; required fails closed elsewhere. */
    readonly filesystemSecurity?: FilesystemSecurityMode;
    readonly maxFileReadBytes?: number;
    readonly maxFileWriteBytes?: number;
    readonly networkOrigins?: readonly string[];
    readonly networkMethods?: readonly string[];
    readonly maxRequestBytes?: number;
    readonly maxResponseBytes?: number;
    /** Private/loopback/link-local/reserved IPs are denied by default, even for allowed DNS names. */
    readonly networkAllowPrivateAddresses?: boolean;
    readonly mcpCall?: (input: Readonly<McpCallInput>, context: GatewayAdapterContext) => unknown | Promise<unknown>;
    readonly browserCall?: (input: Readonly<BrowserCallInput>, context: GatewayAdapterContext) => unknown | Promise<unknown>;
    readonly desktopCall?: (input: Readonly<DesktopCallInput>, context: GatewayAdapterContext) => unknown | Promise<unknown>;
}
/** Creates Node host adapters with a second, host-local fail-closed boundary. */
export declare function createNodeGatewayAdapters(options: NodeGatewayAdapterOptions): Promise<GatewayAdapters>;
export {};
//# sourceMappingURL=node-adapters.d.ts.map