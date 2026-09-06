import type {
  AdmittedCapability,
  AgentCapabilityCatalogEntry,
  CapabilityRisk,
  CapabilityRegistryState,
} from "@function-hooks/capabilities";
import type { AgentGateway } from "@function-hooks/gateway";
import type { AnyCapabilityRoute, ExecutionRouter, RouterDispatchOptions } from "@function-hooks/router";
import type { EffectGatewayClient } from "./effect-gateway-bridge.js";

export type ExecutionClass = "pure" | "read" | "mutation" | "critical";

export type ExecutorId = "fast" | "guarded" | "effect";

export interface RuntimeExecutionPolicy {
  readonly executionClass: ExecutionClass;
  readonly executor: ExecutorId;
  readonly schemaClassDigest: string;
  readonly policyHookId?: string;
  readonly pureHandlerId?: string;
  readonly readDescriptorDigest?: string;
  /**
   * Pure/read do not enter Effect Fabric by default. When lightweight auth is
   * still required, the admission record must carry a policy hook id.
   */
  readonly requiresLightweightAuth: boolean;
  /** Marker for future read-only sub-tiering inside the fast path. */
  readonly trustedRead: boolean;
}

export interface RuntimeAdmittedCapability {
  readonly capability: AdmittedCapability;
  readonly execution: RuntimeExecutionPolicy;
}

export interface AdmitRuntimeCapabilityOptions {
  readonly admissionId: string;
  readonly policyVersion: string;
  readonly admittedAt?: string;
  readonly reason?: string;
  readonly executionClass: ExecutionClass;
  readonly policyHookId?: string;
  readonly pureHandlerId?: string;
  readonly requiresLightweightAuth?: boolean;
  readonly trustedRead?: boolean;
}

export interface RuntimeCapabilityRegistryRecord {
  readonly capability: RuntimeAdmittedCapability;
  readonly state: CapabilityRegistryState;
  readonly stateVersion: number;
  readonly updatedAt: string;
  readonly reason?: string;
}

export interface RuntimeCapabilityRegistryFilter {
  readonly state?: CapabilityRegistryState;
  readonly app?: string;
  readonly capability?: string;
  readonly executionClass?: ExecutionClass;
}

export interface RuntimeCapabilityRegistrySnapshot {
  readonly format: "function-hooks.runtime-capability-registry.v0.12";
  readonly records: readonly RuntimeCapabilityRegistryRecord[];
}

export interface RuntimeRegistryChange {
  readonly id: string;
  readonly state: CapabilityRegistryState;
  readonly stateVersion: number;
}

export type RuntimeRegistryListener = (change: RuntimeRegistryChange) => void;

export interface RuntimeCapabilityRegistry {
  register(capability: RuntimeAdmittedCapability): Promise<RuntimeCapabilityRegistryRecord>;
  get(id: string): Promise<RuntimeCapabilityRegistryRecord | undefined>;
  list(filter?: RuntimeCapabilityRegistryFilter): Promise<readonly RuntimeCapabilityRegistryRecord[]>;
  activate(id: string, reason?: string): Promise<RuntimeCapabilityRegistryRecord>;
  suspend(id: string, reason?: string): Promise<RuntimeCapabilityRegistryRecord>;
  revoke(id: string, reason?: string): Promise<RuntimeCapabilityRegistryRecord>;
  supersede(id: string, reason?: string): Promise<RuntimeCapabilityRegistryRecord>;
  snapshot(): Promise<RuntimeCapabilityRegistrySnapshot>;
  subscribe?(listener: RuntimeRegistryListener): () => void;
}

export interface RuntimeCapabilityCatalogEntry extends AgentCapabilityCatalogEntry {
  readonly executionClass: ExecutionClass;
  readonly executor: ExecutorId;
  readonly schemaClassDigest: string;
  readonly policyHookId?: string;
  readonly pureHandlerId?: string;
  readonly readDescriptorDigest?: string;
  readonly requiresLightweightAuth: boolean;
  readonly trustedRead: boolean;
}

export interface RuntimeMcpReadDescriptorPin {
  readonly server: string;
  readonly tool: string;
  readonly inputSchema: unknown;
  readonly authenticated: true;
  readonly readOnly: true;
  readonly epoch: string;
  readonly descriptorDigest: string;
}

export interface RuntimeMcpReadDescriptorAuthority {
  describeTool(server: string, tool: string): Promise<{
    readonly server: string;
    readonly tool: string;
    readonly inputSchema: unknown;
    readonly authenticated: boolean;
    readonly readOnly: boolean;
    readonly epoch: string | number;
  }>;
}

export interface InvokeCapabilityRequest {
  readonly id: string;
  /** Non-authoritative caller correlation id for audit and tracing. */
  readonly callerCorrelationId?: string;
  /** @deprecated Legacy alias for callerCorrelationId. Never authoritative. */
  readonly actionId?: string;
  readonly input?: unknown;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly semanticMetadata?: Readonly<Record<string, string>>;
  readonly idempotencyKey?: string;
}

export interface InvokeCapabilityContext extends RouterDispatchOptions {
  readonly subject?: string;
  readonly allowDestructive?: boolean;
  readonly approvalToken?: string;
}

export interface CompiledCapabilityHandle {
  readonly id: string;
  readonly app: string;
  readonly capability: string;
  readonly executor: ExecutorId;
  readonly executionClass: ExecutionClass;
  readonly risk: CapabilityRisk;
  readonly schemaHash: string;
  readonly schemaClassDigest: string;
  readonly policyHookId?: string;
  readonly pureHandlerId?: string;
  readonly readDescriptorDigest?: string;
  readonly requiresLightweightAuth: boolean;
  readonly trustedRead: boolean;
  readonly stateVersion: number;
  readonly admitted: RuntimeAdmittedCapability;
  readonly mcpReadDescriptorPin?: RuntimeMcpReadDescriptorPin;
  readonly route?: AnyCapabilityRoute;
  readonly directRouter?: ExecutionRouter;
}

export interface RuntimePolicyContext {
  readonly handle: CompiledCapabilityHandle;
  readonly request: InvokeCapabilityRequest;
  readonly context: InvokeCapabilityContext;
}

export type RuntimePolicyHook = (context: RuntimePolicyContext) => Promise<void> | void;

export type PureCapabilityHandler = (context: RuntimePolicyContext) => Promise<unknown> | unknown;

export interface RuntimeReceiptHooks {
  readonly onStart?: (context: RuntimePolicyContext) => Promise<void> | void;
  readonly onSuccess?: (context: RuntimePolicyContext & { readonly result: unknown }) => Promise<void> | void;
  readonly onFailure?: (context: RuntimePolicyContext & { readonly error: Error }) => Promise<void> | void;
}

export interface RuntimeExecutors {
  readonly fast: {
    execute(handle: CompiledCapabilityHandle, request: InvokeCapabilityRequest, context: InvokeCapabilityContext): Promise<unknown>;
  };
  readonly guarded: {
    execute(handle: CompiledCapabilityHandle, request: InvokeCapabilityRequest, context: InvokeCapabilityContext): Promise<unknown>;
  };
  readonly effect: {
    execute(handle: CompiledCapabilityHandle, request: InvokeCapabilityRequest, context: InvokeCapabilityContext): Promise<unknown>;
  };
}

export interface CreateFunctionHooksRuntimeOptions {
  readonly registry: RuntimeCapabilityRegistry;
  readonly fastGateway: AgentGateway;
  readonly effectGateway: EffectGatewayClient;
  readonly mcpReadDescriptorAuthority?: RuntimeMcpReadDescriptorAuthority;
  readonly policyHooks?: Readonly<Record<string, RuntimePolicyHook>> | ReadonlyMap<string, RuntimePolicyHook>;
  readonly pureHandlers?: Readonly<Record<string, PureCapabilityHandler>> | ReadonlyMap<string, PureCapabilityHandler>;
  readonly receipts?: RuntimeReceiptHooks;
}

export interface FunctionHooksRuntime {
  searchCapabilities(filter?: RuntimeCapabilityRegistryFilter): Promise<readonly RuntimeCapabilityCatalogEntry[]>;
  resolveHandle(id: string): Promise<CompiledCapabilityHandle>;
  invokeCapability(request: InvokeCapabilityRequest, context?: InvokeCapabilityContext): Promise<unknown>;
  clearHandleCache(id?: string): void;
  readonly cacheSize: number;
  close(): Promise<void>;
}
