import { capabilitySha256 } from "@function-hooks/capabilities";
import { RuntimeExecutionPolicyError } from "./errors.js";
import type { InvokeCapabilityRequest } from "./types.js";

export const REQUEST_CALLER_CORRELATION_ID_METADATA =
  "function-hooks.runtime.caller-correlation-id";

export interface TrustedWriteIdentity {
  readonly subject: string;
  readonly callerIdempotencyKey: string;
  readonly callerCorrelationId?: string;
  readonly semanticMetadata?: Readonly<Record<string, string>>;
  readonly actionDigest: string;
  readonly namespaceKey: string;
  readonly trustedIdempotencyKey: string;
  readonly trustedActionId: string;
  readonly traceId: string;
  readonly gatewayMetadata?: Readonly<Record<string, string>>;
}

function optionalNonEmptyString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new RuntimeExecutionPolicyError(`${field} must be a string when provided.`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new RuntimeExecutionPolicyError(`${field} must be a non-empty string when provided.`);
  }
  return normalized;
}

function normalizedStringRecord(
  value: unknown,
  field: string,
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RuntimeExecutionPolicyError(`${field} must be an object when provided.`);
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const normalized: Record<string, string> = {};
  for (const [key, entry] of entries) {
    if (key.trim().length === 0) {
      throw new RuntimeExecutionPolicyError(`${field} keys must be non-empty strings.`);
    }
    if (typeof entry !== "string") {
      throw new RuntimeExecutionPolicyError(`${field}.${key} must be a string.`);
    }
    normalized[key] = entry;
  }
  return Object.freeze(normalized);
}

export function normalizedCallerCorrelationId(request: InvokeCapabilityRequest): string | undefined {
  const legacy = optionalNonEmptyString(request.actionId, "request.actionId");
  const explicit = optionalNonEmptyString(
    request.callerCorrelationId,
    "request.callerCorrelationId",
  );
  if (legacy && explicit && legacy !== explicit) {
    throw new RuntimeExecutionPolicyError(
      "request.actionId and request.callerCorrelationId must match when both are provided.",
    );
  }
  return explicit ?? legacy;
}

export function normalizedSemanticMetadata(
  request: InvokeCapabilityRequest,
): Readonly<Record<string, string>> | undefined {
  return normalizedStringRecord(request.semanticMetadata, "request.semanticMetadata");
}

export function mergedRequestMetadata(
  request: InvokeCapabilityRequest,
): Readonly<Record<string, string>> | undefined {
  const merged: Record<string, string> = {};
  const extend = (
    source: Readonly<Record<string, string>> | undefined,
    field: "request.metadata" | "request.semanticMetadata",
  ): void => {
    if (!source) return;
    for (const [key, value] of Object.entries(source)) {
      const prior = merged[key];
      if (prior !== undefined && prior !== value) {
        throw new RuntimeExecutionPolicyError(
          `${field} conflicts with another metadata source for key ${key}.`,
        );
      }
      merged[key] = value;
    }
  };

  extend(normalizedStringRecord(request.metadata, "request.metadata"), "request.metadata");
  extend(normalizedSemanticMetadata(request), "request.semanticMetadata");

  const callerCorrelationId = normalizedCallerCorrelationId(request);
  if (callerCorrelationId !== undefined) {
    merged[REQUEST_CALLER_CORRELATION_ID_METADATA] = callerCorrelationId;
  }

  return Object.keys(merged).length === 0 ? undefined : Object.freeze(merged);
}

export function semanticActionDigest(input: {
  readonly requestInput?: unknown;
  readonly semanticMetadata?: Readonly<Record<string, string>>;
}): string {
  const semanticMetadata =
    input.semanticMetadata && Object.keys(input.semanticMetadata).length > 0
      ? input.semanticMetadata
      : undefined;
  return capabilitySha256({
    ...(input.requestInput === undefined ? {} : { input: input.requestInput }),
    ...(semanticMetadata === undefined ? {} : { metadata: semanticMetadata }),
  });
}

export function deriveTrustedWriteIdentity(input: {
  readonly subject: string;
  readonly capabilityId: string;
  readonly request: InvokeCapabilityRequest;
}): TrustedWriteIdentity {
  const idempotencyKey = optionalNonEmptyString(
    input.request.idempotencyKey,
    "request.idempotencyKey",
  );
  if (idempotencyKey === undefined) {
    throw new RuntimeExecutionPolicyError(
      `Capability ${input.capabilityId} requires a non-empty idempotencyKey.`,
    );
  }
  const callerCorrelationId = normalizedCallerCorrelationId(input.request);
  const semanticMetadata = normalizedSemanticMetadata(input.request);
  const actionDigest = semanticActionDigest({
    requestInput: input.request.input,
    semanticMetadata,
  });
  const trustedIdempotencyKey = capabilitySha256({
    subject: input.subject,
    capabilityId: input.capabilityId,
    idempotencyKey,
  });
  const trustedActionId = capabilitySha256({
    subject: input.subject,
    capabilityId: input.capabilityId,
    idempotencyKey,
    actionDigest,
  });

  return Object.freeze({
    subject: input.subject,
    callerIdempotencyKey: idempotencyKey,
    ...(callerCorrelationId === undefined ? {} : { callerCorrelationId }),
    ...(semanticMetadata === undefined ? {} : { semanticMetadata }),
    actionDigest,
    namespaceKey: `${input.subject}\u0000${input.capabilityId}\u0000${idempotencyKey}`,
    trustedIdempotencyKey,
    trustedActionId,
    traceId: callerCorrelationId ?? trustedActionId,
    ...(mergedRequestMetadata(input.request) === undefined
      ? {}
      : { gatewayMetadata: mergedRequestMetadata(input.request) }),
  });
}
