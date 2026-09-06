import type { DeepReadonly, Engine, EventName, MaybePromise, Runtime, RuntimeTraceRecord } from "@function-hooks/core";
export interface GatewayActionBase {
    readonly actionId: string;
    readonly metadata?: Readonly<Record<string, string>>;
}
export interface McpCallInput extends GatewayActionBase {
    readonly server: string;
    readonly tool: string;
    readonly args?: unknown;
}
export interface BrowserCallInput extends GatewayActionBase {
    readonly operation: string;
    readonly target?: string;
    readonly args?: unknown;
}
/** Generic desktop/computer-control capability. Host adapters decide how an application is automated. */
export interface DesktopCallInput extends GatewayActionBase {
    readonly application: string;
    readonly operation: string;
    readonly target?: string;
    readonly args?: unknown;
}
export interface FileReadInput extends GatewayActionBase {
    readonly path: string;
}
export interface FileWriteInput extends GatewayActionBase {
    readonly path: string;
    readonly data: string;
}
export interface ProcessExecInput extends GatewayActionBase {
    /** Preferred secure execution path: selects a host-defined process capability profile. */
    readonly profile?: string;
    /** @deprecated Raw command execution requires explicit legacy host opt-in and is denied by default. */
    readonly command?: string;
    readonly args?: readonly string[];
    readonly cwd?: string;
    readonly timeoutMs?: number;
}
export interface NetworkRequestInput extends GatewayActionBase {
    readonly url: string;
    readonly method?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
}
export interface FileReadResult {
    readonly data: string;
    readonly bytes: number;
}
export interface FileWriteResult {
    readonly bytesWritten: number;
}
export interface ProcessExecResult {
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
}
export interface NetworkRequestResult {
    readonly status: number;
    readonly statusText: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    readonly url: string;
}
export type GatewayEvents = {
    "mcp.call": {
        input: McpCallInput;
        result: unknown;
    };
    "browser.call": {
        input: BrowserCallInput;
        result: unknown;
    };
    "desktop.call": {
        input: DesktopCallInput;
        result: unknown;
    };
    "fs.read": {
        input: FileReadInput;
        result: FileReadResult;
    };
    "fs.write": {
        input: FileWriteInput;
        result: FileWriteResult;
    };
    "process.exec": {
        input: ProcessExecInput;
        result: ProcessExecResult;
    };
    "network.request": {
        input: NetworkRequestInput;
        result: NetworkRequestResult;
    };
};
export type GatewayEventName = EventName<GatewayEvents>;
export type GatewayInput<K extends GatewayEventName = GatewayEventName> = GatewayEvents[K]["input"];
export type GatewayResult<K extends GatewayEventName = GatewayEventName> = GatewayEvents[K]["result"];
export interface GatewayAdapterContext {
    readonly event: GatewayEventName;
    readonly origin: string;
    readonly signal: AbortSignal;
    readonly engine: Engine<GatewayEvents>;
}
export type GatewayAdapter<K extends GatewayEventName> = (input: DeepReadonly<GatewayEvents[K]["input"]>, context: GatewayAdapterContext) => MaybePromise<GatewayEvents[K]["result"]>;
export type GatewayAdapters = Partial<{
    [K in GatewayEventName]: GatewayAdapter<K>;
}>;
export interface GatewayPolicyContext {
    readonly event: GatewayEventName;
    readonly origin: string;
    readonly input: DeepReadonly<GatewayInput>;
}
export interface GatewayPolicyDecision {
    readonly effect: "allow" | "deny";
    readonly reason?: string;
    /** Optional replacement input. It is validated again before entering the lower chain. */
    readonly rewrite?: GatewayInput;
    readonly approval?: "required" | "not-required";
}
export type GatewayAuthorizer = (context: GatewayPolicyContext) => MaybePromise<GatewayPolicyDecision>;
export interface GatewayApprovalContext extends GatewayPolicyContext {
    readonly reason?: string;
    readonly signal: AbortSignal;
}
export type GatewayApprovalProvider = (context: GatewayApprovalContext) => MaybePromise<boolean>;
export type GatewayAuditPhase = "policy.denied" | "approval.denied" | "execution.start" | "execution.success" | "execution.failure";
export interface GatewayAuditRecord {
    readonly at: number;
    readonly phase: GatewayAuditPhase;
    readonly event: GatewayEventName;
    readonly origin: string;
    readonly actionId: string;
    readonly input: unknown;
    readonly reason?: string;
    readonly result?: unknown;
    readonly error?: string;
}
export type GatewayAuditSink = (record: GatewayAuditRecord) => MaybePromise<void>;
export interface AgentGateway {
    readonly runtime: Runtime<GatewayEvents>;
    readonly engine: Engine<GatewayEvents>;
    dispatch<K extends GatewayEventName>(event: K, input: GatewayEvents[K]["input"], options?: {
        readonly origin?: string;
        readonly signal?: AbortSignal;
        readonly timeoutMs?: number;
    }): Promise<GatewayEvents[K]["result"]>;
    close(): Promise<void>;
}
export interface GatewayTraceOptions {
    readonly trace?: (record: RuntimeTraceRecord) => void;
    readonly defaultTimeoutMs?: number;
}
export declare const GATEWAY_EVENTS: readonly ["mcp.call", "browser.call", "desktop.call", "fs.read", "fs.write", "process.exec", "network.request"];
export declare const DEFAULT_RECEIPT_EVENTS: readonly ["mcp.call", "browser.call", "desktop.call", "fs.write", "process.exec", "network.request"];
//# sourceMappingURL=types.d.ts.map