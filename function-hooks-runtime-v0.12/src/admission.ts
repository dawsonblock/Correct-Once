import {
  admitCapability,
  assertAdmittedCapability,
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

function normalizePolicy(
  capability: AdmittedCapability,
  options: {
    executionClass: ExecutionClass;
    policyHookId?: string;
    requiresLightweightAuth?: boolean;
    trustedRead?: boolean;
  },
): RuntimeExecutionPolicy {
  const executionClass = options.executionClass;
  const policyHookId = options.policyHookId?.trim();
  const requiresLightweightAuth = options.requiresLightweightAuth ?? (executionClass === "read");
  const trustedRead =
    options.trustedRead ?? (executionClass === "read" && requiresLightweightAuth === false);

  if (policyHookId === "") {
    throw new RuntimeExecutionPolicyError("policyHookId must be a non-empty string when provided.");
  }
  if (trustedRead && executionClass !== "read") {
    throw new RuntimeExecutionPolicyError("trustedRead can only be used with executionClass=read.");
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
    ...(policyHookId ? { policyHookId } : {}),
    requiresLightweightAuth,
    trustedRead,
  });
}

export function attachRuntimeExecution(
  capability: AdmittedCapability,
  options: {
    readonly executionClass: ExecutionClass;
    readonly policyHookId?: string;
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
  normalizePolicy(candidate.capability, candidate.execution);
}
