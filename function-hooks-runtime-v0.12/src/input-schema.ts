import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import { RuntimeExecutionPolicyError } from "./errors.js";
import type { CompiledCapabilityHandle, InvokeCapabilityRequest } from "./types.js";

const ajv = new Ajv({
  allErrors: true,
  allowUnionTypes: true,
  strict: false,
});

const validatorCache = new Map<string, ValidateFunction<unknown>>();

function schemaCandidate(request: InvokeCapabilityRequest): unknown {
  return request.input === undefined ? null : request.input;
}

function formatPath(path: string): string {
  return path.length === 0 ? "$" : `$${path}`;
}

function formatError(error: ErrorObject): string {
  const at = formatPath(error.instancePath);
  if (error.keyword === "required") {
    const missing = (error.params as { readonly missingProperty?: unknown }).missingProperty;
    if (typeof missing === "string" && missing.length > 0) {
      return `${at}.${missing} is required`;
    }
  }
  if (error.keyword === "additionalProperties") {
    const extra = (error.params as { readonly additionalProperty?: unknown }).additionalProperty;
    if (typeof extra === "string" && extra.length > 0) {
      return `${at}.${extra} is not allowed`;
    }
  }
  return `${at}: ${error.message ?? error.keyword}`;
}

function validatorFor(handle: CompiledCapabilityHandle): ValidateFunction<unknown> {
  const cached = validatorCache.get(handle.schemaHash);
  if (cached) return cached;

  const schema = handle.admitted.capability.inputSchema;
  const isJsonSchema =
    typeof schema === "boolean" || (schema !== null && typeof schema === "object" && !Array.isArray(schema));
  if (!isJsonSchema) {
    throw new RuntimeExecutionPolicyError(
      `Capability ${handle.id} admitted inputSchema must be a JSON Schema object or boolean.`,
    );
  }

  try {
    const compiled = ajv.compile(schema);
    validatorCache.set(handle.schemaHash, compiled);
    return compiled;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new RuntimeExecutionPolicyError(
      `Capability ${handle.id} admitted inputSchema is invalid: ${detail}`,
    );
  }
}

export function assertRequestMatchesPinnedInputSchema(
  handle: CompiledCapabilityHandle,
  request: InvokeCapabilityRequest,
): void {
  const validator = validatorFor(handle);
  const candidate = schemaCandidate(request);
  if (validator(candidate)) return;

  const errors = validator.errors ?? [];
  const detail =
    errors.length === 0
      ? "validation failed"
      : errors.map((error) => formatError(error)).join("; ");
  throw new RuntimeExecutionPolicyError(
    `Capability ${handle.id} request.input failed admitted inputSchema validation: ${detail}`,
  );
}
