export type CapabilitySideEffect = "read" | "write" | "external" | "destructive" | "unknown";
export type CapabilitySensitivity = "public" | "private" | "secret" | "unknown";
export type CapabilityRisk = "low" | "medium" | "high" | "critical";
export interface CapabilityProvenance {
    readonly connectorId: string;
    readonly connectorType: string;
    readonly discoveredAt: string;
    readonly sourceDigest?: string;
    readonly schemaDigest: string;
    readonly version?: string;
}
export interface McpCapabilityImplementation {
    readonly kind: "mcp";
    readonly server: string;
    readonly tool: string;
}
export interface HttpCapabilityImplementation {
    readonly kind: "http";
    readonly url: string;
    readonly method?: string;
    readonly headers?: Readonly<Record<string, string>>;
    /** How request.input becomes the HTTP body. Defaults to json. */
    readonly body?: "none" | "text" | "json";
}
export interface BrowserCapabilityImplementation {
    readonly kind: "browser";
    readonly operation: string;
    readonly target?: string;
}
export interface DesktopCapabilityImplementation {
    readonly kind: "desktop";
    readonly application: string;
    readonly operation: string;
    readonly target?: string;
}
export interface ProcessCapabilityImplementation {
    readonly kind: "process";
    readonly profile: string;
    readonly cwd?: string;
    readonly timeoutMs?: number;
}
export interface FileReadCapabilityImplementation {
    readonly kind: "filesystem.read";
    /** Optional fixed path. Without it, request.input must provide a path. */
    readonly path?: string;
}
export interface FileWriteCapabilityImplementation {
    readonly kind: "filesystem.write";
    /** Optional fixed path. Without it, request.input must provide a path. */
    readonly path?: string;
}
export type CapabilityImplementation = McpCapabilityImplementation | HttpCapabilityImplementation | BrowserCapabilityImplementation | DesktopCapabilityImplementation | ProcessCapabilityImplementation | FileReadCapabilityImplementation | FileWriteCapabilityImplementation;
export interface CapabilityDescriptor {
    readonly id: string;
    readonly app: string;
    readonly capability: string;
    readonly description: string;
    readonly inputSchema: unknown;
    readonly outputSchema?: unknown;
    readonly schemaHash: string;
    readonly descriptorHash: string;
    readonly sideEffect: CapabilitySideEffect;
    readonly sensitivity: CapabilitySensitivity;
    readonly risk: CapabilityRisk;
    readonly provenance: CapabilityProvenance;
    readonly implementation: CapabilityImplementation;
}
export interface CapabilityCandidate extends CapabilityDescriptor {
    readonly lifecycle: "candidate";
    /** Stable across rediscovery timestamps; bound to descriptor + connector identity/source. */
    readonly candidateHash: string;
}
export interface CapabilityAdmissionEvidence {
    readonly kind: "function-hooks.capability-admission.v1";
    readonly admissionId: string;
    readonly admittedAt: string;
    readonly policyVersion: string;
    readonly candidateHash: string;
    readonly descriptorHash: string;
    readonly reason?: string;
}
export interface AdmittedCapability extends CapabilityDescriptor {
    readonly lifecycle: "admitted";
    readonly candidateHash: string;
    readonly admission: CapabilityAdmissionEvidence;
}
export interface CreateCapabilityCandidateInput {
    readonly id?: string;
    readonly app: string;
    readonly capability: string;
    readonly description: string;
    readonly inputSchema: unknown;
    readonly outputSchema?: unknown;
    readonly sideEffect: CapabilitySideEffect;
    readonly sensitivity: CapabilitySensitivity;
    readonly risk: CapabilityRisk;
    readonly provenance: Omit<CapabilityProvenance, "schemaDigest" | "discoveredAt"> & {
        readonly discoveredAt?: string;
    };
    readonly implementation: CapabilityImplementation;
}
export interface AdmitCapabilityOptions {
    readonly admissionId: string;
    readonly policyVersion: string;
    readonly admittedAt?: string;
    readonly reason?: string;
}
export type CapabilityRegistryState = "active" | "suspended" | "revoked" | "superseded";
export interface CapabilityRegistryRecord {
    readonly capability: AdmittedCapability;
    readonly state: CapabilityRegistryState;
    readonly stateVersion: number;
    readonly updatedAt: string;
    readonly reason?: string;
}
export interface CapabilityRegistryFilter {
    readonly state?: CapabilityRegistryState;
    readonly app?: string;
    readonly capability?: string;
}
export interface CapabilityRegistrySnapshot {
    readonly format: "function-hooks.capability-registry.v1";
    readonly records: readonly CapabilityRegistryRecord[];
}
export interface CapabilityRegistryPersistence {
    load(): Promise<CapabilityRegistrySnapshot | undefined>;
    save(snapshot: CapabilityRegistrySnapshot): Promise<void>;
}
export interface CapabilityRegistry {
    register(capability: AdmittedCapability): Promise<CapabilityRegistryRecord>;
    get(id: string): Promise<CapabilityRegistryRecord | undefined>;
    list(filter?: CapabilityRegistryFilter): Promise<readonly CapabilityRegistryRecord[]>;
    activate(id: string, reason?: string): Promise<CapabilityRegistryRecord>;
    suspend(id: string, reason?: string): Promise<CapabilityRegistryRecord>;
    revoke(id: string, reason?: string): Promise<CapabilityRegistryRecord>;
    supersede(id: string, reason?: string): Promise<CapabilityRegistryRecord>;
    snapshot(): Promise<CapabilityRegistrySnapshot>;
}
export interface AgentCapabilityCatalogEntry {
    readonly id: string;
    readonly app: string;
    readonly capability: string;
    readonly description: string;
    readonly inputSchema: unknown;
    readonly outputSchema?: unknown;
    readonly sideEffect: CapabilitySideEffect;
    readonly sensitivity: CapabilitySensitivity;
    readonly risk: CapabilityRisk;
    readonly schemaHash: string;
}
//# sourceMappingURL=types.d.ts.map