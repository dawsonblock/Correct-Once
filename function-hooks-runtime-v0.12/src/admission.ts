import {
  admitCapability,
  assertAdmittedCapability,
  capabilitySha256,
  capabilitySnapshot,
  type AdmittedCapability,
  type CapabilityCandidate,
} from "@function-hooks/capabilities";
import { RuntimeExecutionPolicyError } from "./errors.js";
import type {
  AdmitRuntimeCapabilityOptions,
  ExecutionClass,
  RuntimeAdmittedCapability,
  RuntimeExecutionPolicy,
} from "./types.js";

const READ_ONLY_SIDE_EFFECTS = new Set(["read"]);
const MUTATING_SIDE_EFFECTS = new Set(["write", "external"]);
const HIGH_TIER_SIDE_EFFECTS = new Set(["write", "external", "destructive"]);

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

function schemaClassDigest(
  capability: AdmittedCapability,
  input: {
    readonly executionClass: ExecutionClass;
    readonly executor: ReturnType<typeof executorForClass>;
    readonly policyHookId?: string;
    readonly pureHandlerId?: string;
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
    requiresLightweightAuth: input.requiresLightweightAuth,
    trustedRead: input.trustedRead,
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
  const requiresLightweightAuth = options.requiresLightweightAuth ?? (executionClass === "read");
  const trustedRead =
    options.trustedRead ?? (executionClass === "read" && requiresLightweightAuth === false);
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
  if (requiresLightweightAuth && !policyHookId) {
    throw new RuntimeExecutionPolicyError(
      `Capability ${capability.id} requires lightweight auth but no policyHookId was admitted.`,
    );
  }

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
      requiresLightweightAuth,
      trustedRead,
    }),
    ...(policyHookId ? { policyHookId } : {}),
    ...(pureHandlerId ? { pureHandlerId } : {}),
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
}
