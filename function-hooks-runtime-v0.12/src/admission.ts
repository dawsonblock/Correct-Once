import {
  admitCapability,
  assertAdmittedCapability,
  capabilitySha256,
  capabilitySnapshot,
  type AdmittedCapability,
  type CapabilityCandidate,
  type CapabilityImplementation,
} from "@function-hooks/capabilities";
import { RuntimeExecutionPolicyError } from "./errors.js";
import type {
  AdmitRuntimeCapabilityOptions,
  ExecutionClass,
  RuntimeMcpReadDescriptorPin,
  RuntimeAdmittedCapability,
  RuntimeExecutionPolicy,
} from "./types.js";

const READ_ONLY_SIDE_EFFECTS = new Set(["read"]);
const MUTATING_SIDE_EFFECTS = new Set(["write", "external"]);
const HIGH_TIER_SIDE_EFFECTS = new Set(["write", "external", "destructive"]);
const AUTH_REQUIRED_SENSITIVITIES = new Set(["private", "secret", "unknown"]);
const READ_ONLY_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function executorForClass(executionClass: ExecutionClass) {
  switch (executionClass) {
    case "pure":
    case "read":
      return "fast" as const;
    case "mutation":
      return "guarded" as const;
    case "critical":
      return "effect" as const;
  }
}

function normalizedHttpMethod(implementation: Extract<CapabilityImplementation, { readonly kind: "http" }>): string {
  return (implementation.method ?? "GET").trim().toUpperCase();
}

function hasAuthenticatedReadOnlyDescriptor(capability: AdmittedCapability): boolean {
  return mcpReadDescriptorPin(capability) !== undefined;
}

function isReadCompatibleImplementation(
  capability: AdmittedCapability,
): boolean {
  const implementation = capability.implementation;
  switch (implementation.kind) {
    case "filesystem.read":
      return true;
    case "http":
      return READ_ONLY_HTTP_METHODS.has(normalizedHttpMethod(implementation));
    case "mcp":
      return hasAuthenticatedReadOnlyDescriptor(capability);
    default:
      return false;
  }
}

function isMutationCompatibleImplementation(
  implementation: CapabilityImplementation,
): boolean {
  switch (implementation.kind) {
    case "filesystem.write":
    case "process":
    case "browser":
    case "desktop":
    case "mcp":
      return true;
    case "http":
      return !READ_ONLY_HTTP_METHODS.has(normalizedHttpMethod(implementation));
    default:
      return false;
  }
}

function describeImplementation(implementation: CapabilityImplementation): string {
  switch (implementation.kind) {
    case "http":
      return `http.${normalizedHttpMethod(implementation)}`;
    case "filesystem.read":
    case "filesystem.write":
    case "process":
    case "browser":
    case "desktop":
    case "mcp":
      return implementation.kind;
  }
}

function assertImplementationCompatibility(
  capability: AdmittedCapability,
  executionClass: ExecutionClass,
): void {
  const implementation = capability.implementation;
  if (executionClass === "pure" || executionClass === "read") {
    if (isReadCompatibleImplementation(capability)) return;
    if (implementation.kind === "mcp") {
      throw new RuntimeExecutionPolicyError(
        `Capability ${capability.id} mcp reads require pinned descriptor evidence for server/tool/inputSchema/readOnly/authenticated/epoch.`,
      );
    }
    throw new RuntimeExecutionPolicyError(
      `Capability ${capability.id} implementation=${describeImplementation(implementation)} is incompatible with executionClass=${executionClass}.`,
    );
  }
  if (executionClass === "mutation") {
    if (isMutationCompatibleImplementation(implementation)) return;
    throw new RuntimeExecutionPolicyError(
      `Capability ${capability.id} implementation=${describeImplementation(implementation)} is incompatible with executionClass=mutation.`,
    );
  }
  if (implementation.kind !== "mcp") {
    throw new RuntimeExecutionPolicyError(
      `Capability ${capability.id} implementation=${describeImplementation(implementation)} is incompatible with executionClass=critical; the governed critical path is MCP-only in v0.13.`,
    );
  }
}

function schemaClassDigest(
  capability: AdmittedCapability,
  input: {
    readonly executionClass: ExecutionClass;
    readonly executor: ReturnType<typeof executorForClass>;
    readonly policyHookId?: string;
    readonly pureHandlerId?: string;
    readonly readDescriptorDigest?: string;
    readonly requiresLightweightAuth: boolean;
    readonly trustedRead: boolean;
  },
): string {
  return capabilitySha256({
    schemaHash: capability.schemaHash,
    executionClass: input.executionClass,
    executor: input.executor,
    ...(input.policyHookId === undefined ? {} : { policyHookId: input.policyHookId }),
    ...(input.pureHandlerId === undefined ? {} : { pureHandlerId: input.pureHandlerId }),
    ...(input.readDescriptorDigest === undefined
      ? {}
      : { readDescriptorDigest: input.readDescriptorDigest }),
    requiresLightweightAuth: input.requiresLightweightAuth,
    trustedRead: input.trustedRead,
  });
}

function normalizedReadDescriptorEpoch(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length === 0 ? undefined : normalized;
  }
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
  ) {
    return String(value);
  }
  return undefined;
}

export function normalizeMcpReadDescriptorEvidence(input: {
  readonly server: string;
  readonly tool: string;
  readonly inputSchema: unknown;
  readonly authenticated: boolean;
  readonly readOnly: boolean;
  readonly epoch: string | number;
}): RuntimeMcpReadDescriptorPin {
  const epoch = normalizedReadDescriptorEpoch(input.epoch);
  if (epoch === undefined) {
    throw new RuntimeExecutionPolicyError(
      `Pinned MCP read descriptor for ${input.server}/${input.tool} requires a non-empty epoch.`,
    );
  }
  if (input.authenticated !== true || input.readOnly !== true) {
    throw new RuntimeExecutionPolicyError(
      `Pinned MCP read descriptor for ${input.server}/${input.tool} must remain authenticated=true and readOnly=true.`,
    );
  }
  return capabilitySnapshot({
    server: input.server,
    tool: input.tool,
    inputSchema: input.inputSchema,
    authenticated: true as const,
    readOnly: true as const,
    epoch,
    descriptorDigest: capabilitySha256({
      server: input.server,
      tool: input.tool,
      inputSchema: input.inputSchema,
      authenticated: true,
      readOnly: true,
      epoch,
    }),
  });
}

export function mcpReadDescriptorPin(
  capability: AdmittedCapability,
): RuntimeMcpReadDescriptorPin | undefined {
  const implementation = capability.implementation;
  if (implementation.kind !== "mcp") return undefined;
  const descriptor = (implementation as CapabilityImplementation & {
    readonly descriptor?: unknown;
  }).descriptor;
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    return undefined;
  }
  const readOnlyDescriptor = descriptor as {
    readonly authenticated?: unknown;
    readonly readOnly?: unknown;
    readonly inputSchema?: unknown;
    readonly schema?: unknown;
    readonly epoch?: unknown;
    readonly server?: unknown;
    readonly tool?: unknown;
  };
  const descriptorServer =
    typeof readOnlyDescriptor.server === "string" && readOnlyDescriptor.server.length > 0
      ? readOnlyDescriptor.server
      : implementation.server;
  const descriptorTool =
    typeof readOnlyDescriptor.tool === "string" && readOnlyDescriptor.tool.length > 0
      ? readOnlyDescriptor.tool
      : implementation.tool;
  if (descriptorServer !== implementation.server || descriptorTool !== implementation.tool) {
    throw new RuntimeExecutionPolicyError(
      `Capability ${capability.id} mcp descriptor server/tool drifted from implementation pin.`,
    );
  }
  const descriptorSchema = readOnlyDescriptor.inputSchema ?? readOnlyDescriptor.schema;
  if (descriptorSchema === undefined) {
    throw new RuntimeExecutionPolicyError(
      `Capability ${capability.id} mcp read descriptor must pin inputSchema.`,
    );
  }
  if (capabilitySha256(descriptorSchema) !== capabilitySha256(capability.inputSchema)) {
    throw new RuntimeExecutionPolicyError(
      `Capability ${capability.id} mcp read descriptor inputSchema drifted from admitted capability inputSchema.`,
    );
  }
  return normalizeMcpReadDescriptorEvidence({
    server: implementation.server,
    tool: implementation.tool,
    inputSchema: descriptorSchema,
    authenticated: readOnlyDescriptor.authenticated === true,
    readOnly: readOnlyDescriptor.readOnly === true,
    epoch: readOnlyDescriptor.epoch as string | number,
  });
}

function normalizePolicy(
  capability: AdmittedCapability,
  options: {
    executionClass: ExecutionClass;
    policyHookId?: string;
    pureHandlerId?: string;
    requiresLightweightAuth?: boolean;
    trustedRead?: boolean;
  },
): RuntimeExecutionPolicy {
  const executionClass = options.executionClass;
  const policyHookId = options.policyHookId?.trim();
  const pureHandlerId = options.pureHandlerId?.trim();
  const requiresLightweightAuth =
    options.requiresLightweightAuth ??
    (executionClass === "read" || AUTH_REQUIRED_SENSITIVITIES.has(capability.sensitivity));
  const trustedRead =
    options.trustedRead ?? (executionClass === "read" && requiresLightweightAuth === false);
  const readDescriptorDigest =
    executionClass === "read" ? mcpReadDescriptorPin(capability)?.descriptorDigest : undefined;
  const executor = executorForClass(executionClass);

  if (policyHookId === "") {
    throw new RuntimeExecutionPolicyError("policyHookId must be a non-empty string when provided.");
  }
  if (pureHandlerId === "") {
    throw new RuntimeExecutionPolicyError("pureHandlerId must be a non-empty string when provided.");
  }
  if (trustedRead && executionClass !== "read") {
    throw new RuntimeExecutionPolicyError("trustedRead can only be used with executionClass=read.");
  }
  if (executionClass === "pure" && !pureHandlerId) {
    throw new RuntimeExecutionPolicyError(
      `Capability ${capability.id} is pure and must pin a pureHandlerId at admit time.`,
    );
  }
  if (executionClass !== "pure" && pureHandlerId) {
    throw new RuntimeExecutionPolicyError("pureHandlerId can only be used with executionClass=pure.");
  }
  if (AUTH_REQUIRED_SENSITIVITIES.has(capability.sensitivity) && requiresLightweightAuth === false) {
    throw new RuntimeExecutionPolicyError(
      `Capability ${capability.id} sensitivity=${capability.sensitivity} cannot disable lightweight auth.`,
    );
  }
  if (requiresLightweightAuth && !policyHookId) {
    throw new RuntimeExecutionPolicyError(
      `Capability ${capability.id} requires lightweight auth but no policyHookId was admitted.`,
    );
  }

  assertImplementationCompatibility(capability, executionClass);

  const sideEffect = capability.sideEffect;
  if ((executionClass === "pure" || executionClass === "read") && !READ_ONLY_SIDE_EFFECTS.has(sideEffect)) {
    throw new RuntimeExecutionPolicyError(
      `Capability ${capability.id} sideEffect=${sideEffect} is incompatible with executionClass=${executionClass}.`,
    );
  }
  if (executionClass === "mutation" && !MUTATING_SIDE_EFFECTS.has(sideEffect)) {
    throw new RuntimeExecutionPolicyError(
      `Capability ${capability.id} sideEffect=${sideEffect} is incompatible with executionClass=mutation.`,
    );
  }
  if (executionClass === "critical" && !HIGH_TIER_SIDE_EFFECTS.has(sideEffect)) {
    throw new RuntimeExecutionPolicyError(
      `Capability ${capability.id} sideEffect=${sideEffect} is incompatible with executionClass=critical.`,
    );
  }

  return capabilitySnapshot({
    executionClass,
    executor,
    schemaClassDigest: schemaClassDigest(capability, {
      executionClass,
      executor,
      ...(policyHookId ? { policyHookId } : {}),
      ...(pureHandlerId ? { pureHandlerId } : {}),
      ...(readDescriptorDigest === undefined ? {} : { readDescriptorDigest }),
      requiresLightweightAuth,
      trustedRead,
    }),
    ...(policyHookId ? { policyHookId } : {}),
    ...(pureHandlerId ? { pureHandlerId } : {}),
    ...(readDescriptorDigest === undefined ? {} : { readDescriptorDigest }),
    requiresLightweightAuth,
    trustedRead,
  });
}

export function attachRuntimeExecution(
  capability: AdmittedCapability,
  options: {
    readonly executionClass: ExecutionClass;
    readonly policyHookId?: string;
    readonly pureHandlerId?: string;
    readonly requiresLightweightAuth?: boolean;
    readonly trustedRead?: boolean;
  },
): RuntimeAdmittedCapability {
  assertAdmittedCapability(capability);
  return capabilitySnapshot({
    capability,
    execution: normalizePolicy(capability, options),
  });
}

export function admitRuntimeCapability(
  candidate: CapabilityCandidate,
  options: AdmitRuntimeCapabilityOptions,
): RuntimeAdmittedCapability {
  const admitted = admitCapability(candidate, options);
  return attachRuntimeExecution(admitted, options);
}

export function assertRuntimeAdmittedCapability(value: unknown): asserts value is RuntimeAdmittedCapability {
  if (!value || typeof value !== "object") {
    throw new RuntimeExecutionPolicyError("Runtime-admitted capability must be an object.");
  }
  const candidate = value as RuntimeAdmittedCapability;
  assertAdmittedCapability(candidate.capability);
  const normalized = normalizePolicy(candidate.capability, candidate.execution);
  if (candidate.execution.executor !== normalized.executor) {
    throw new RuntimeExecutionPolicyError(
      `Capability ${candidate.capability.id} execution executor drifted from its class pin.`,
    );
  }
  if (candidate.execution.schemaClassDigest !== normalized.schemaClassDigest) {
    throw new RuntimeExecutionPolicyError(
      `Capability ${candidate.capability.id} execution digest drifted from its schema/class pin.`,
    );
  }
  if (candidate.execution.readDescriptorDigest !== normalized.readDescriptorDigest) {
    throw new RuntimeExecutionPolicyError(
      `Capability ${candidate.capability.id} execution read descriptor drifted from its descriptor pin.`,
    );
  }
}
