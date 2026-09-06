import { createExecutionRouter, compileAdmittedCapabilityRoute } from "@function-hooks/router";
import { CapabilityHandleCache } from "./handle-cache.js";
import { assertRuntimeAdmittedCapability } from "./admission.js";
import {
  RuntimeCapabilityNotFoundError,
  RuntimeCapabilityStateError,
  RuntimeExecutionPolicyError,
} from "./errors.js";
import { EffectExecutor, FastExecutor, GuardedExecutor } from "./executors.js";
import { projectRuntimeCapabilityCatalog } from "./registry.js";
import type {
  CompiledCapabilityHandle,
  CreateFunctionHooksRuntimeOptions,
  ExecutorId,
  FunctionHooksRuntime,
  InvokeCapabilityContext,
  InvokeCapabilityRequest,
  RuntimeCapabilityRegistryRecord,
  RuntimeCapabilityRegistryFilter,
  RuntimeExecutors,
} from "./types.js";

function executorFor(record: RuntimeCapabilityRegistryRecord): ExecutorId {
  switch (record.capability.execution.executionClass) {
    case "pure":
    case "read":
      return "fast";
    case "mutation":
      return "guarded";
    case "critical":
      return "effect";
  }
}

function compileHandle(
  record: RuntimeCapabilityRegistryRecord,
  options: CreateFunctionHooksRuntimeOptions,
): CompiledCapabilityHandle {
  assertRuntimeAdmittedCapability(record.capability);
  if (record.state !== "active") {
    throw new RuntimeCapabilityStateError(
      `Capability ${record.capability.capability.id} is not active.`,
    );
  }
  const executor = executorFor(record);
  const route =
    record.capability.execution.executionClass === "pure"
      ? undefined
      : compileAdmittedCapabilityRoute(record.capability.capability);
  const directRouter =
    (record.capability.execution.executionClass === "read" ||
      record.capability.execution.executionClass === "mutation") &&
    route
      ? createExecutionRouter({ gateway: options.fastGateway, routes: [route] })
      : undefined;

  return Object.freeze({
    id: record.capability.capability.id,
    app: record.capability.capability.app,
    capability: record.capability.capability.capability,
    executor,
    executionClass: record.capability.execution.executionClass,
    risk: record.capability.capability.risk,
    schemaHash: record.capability.capability.schemaHash,
    schemaClassDigest: record.capability.execution.schemaClassDigest,
    ...(record.capability.execution.policyHookId
      ? { policyHookId: record.capability.execution.policyHookId }
      : {}),
    ...(record.capability.execution.pureHandlerId
      ? { pureHandlerId: record.capability.execution.pureHandlerId }
      : {}),
    requiresLightweightAuth: record.capability.execution.requiresLightweightAuth,
    trustedRead: record.capability.execution.trustedRead,
    stateVersion: record.stateVersion,
    admitted: record.capability,
    ...(route ? { route } : {}),
    ...(directRouter ? { directRouter } : {}),
  });
}

async function assertCurrentExecutionEpoch(
  registry: CreateFunctionHooksRuntimeOptions["registry"],
  handle: CompiledCapabilityHandle,
): Promise<void> {
  const current = await registry.get(handle.id);
  if (!current) {
    throw new RuntimeCapabilityNotFoundError(
      `Capability ${handle.id} is no longer registered for external execution.`,
    );
  }
  if (current.state !== "active") {
    throw new RuntimeCapabilityStateError(
      `Capability ${handle.id} is ${current.state} and cannot execute externally.`,
    );
  }
  if (current.stateVersion !== handle.stateVersion) {
    throw new RuntimeCapabilityStateError(
      `Capability ${handle.id} changed from stateVersion ${handle.stateVersion} to ${current.stateVersion} before external execution.`,
    );
  }
}

function createExecutors(options: CreateFunctionHooksRuntimeOptions): RuntimeExecutors {
  const assertEffectEpoch = (handle: CompiledCapabilityHandle) =>
    assertCurrentExecutionEpoch(options.registry, handle);
  const effect = new EffectExecutor({
    target: options.effectGateway,
    ...(options.policyHooks === undefined ? {} : { policyHooks: options.policyHooks }),
    assertEffectEpoch,
  });
  return {
    fast: new FastExecutor({
      ...(options.policyHooks === undefined ? {} : { policyHooks: options.policyHooks }),
      ...(options.pureHandlers === undefined ? {} : { pureHandlers: options.pureHandlers }),
    }),
    guarded: new GuardedExecutor({
      ...(options.policyHooks === undefined ? {} : { policyHooks: options.policyHooks }),
      ...(options.receipts === undefined ? {} : { receipts: options.receipts }),
      assertEffectEpoch,
    }),
    effect,
  };
}

function normalizedContext(context: InvokeCapabilityContext | undefined): InvokeCapabilityContext {
  return context ?? {};
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RuntimeExecutionPolicyError(`${field} must be a non-empty string.`);
  }
  return value;
}

function assertNoCallTimeTierOverride(request: InvokeCapabilityRequest): void {
  const raw = request as unknown as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(raw, "executionClass")) {
    throw new RuntimeExecutionPolicyError(
      "executionClass is pinned at admit time and cannot be chosen at call time.",
    );
  }
  if (Object.prototype.hasOwnProperty.call(raw, "executor")) {
    throw new RuntimeExecutionPolicyError(
      "executor is pinned at admit time and cannot be chosen at call time.",
    );
  }
}

function assertHandlePin(handle: CompiledCapabilityHandle): void {
  const pinned = handle.admitted.execution;
  if (handle.executionClass !== pinned.executionClass) {
    throw new RuntimeExecutionPolicyError(
      `Capability ${handle.id} handle class drifted from admission pin.`,
    );
  }
  if (handle.executor !== pinned.executor) {
    throw new RuntimeExecutionPolicyError(
      `Capability ${handle.id} handle executor drifted from admission pin.`,
    );
  }
  if (handle.schemaHash !== handle.admitted.capability.schemaHash) {
    throw new RuntimeExecutionPolicyError(
      `Capability ${handle.id} handle schema hash drifted from admission pin.`,
    );
  }
  if (handle.schemaClassDigest !== pinned.schemaClassDigest) {
    throw new RuntimeExecutionPolicyError(
      `Capability ${handle.id} handle schema/class digest drifted from admission pin.`,
    );
  }
  if (handle.policyHookId !== pinned.policyHookId) {
    throw new RuntimeExecutionPolicyError(
      `Capability ${handle.id} handle policy hook drifted from admission pin.`,
    );
  }
  if (handle.pureHandlerId !== pinned.pureHandlerId) {
    throw new RuntimeExecutionPolicyError(
      `Capability ${handle.id} handle pure handler drifted from admission pin.`,
    );
  }
  if (handle.requiresLightweightAuth !== pinned.requiresLightweightAuth) {
    throw new RuntimeExecutionPolicyError(
      `Capability ${handle.id} handle lightweight auth requirement drifted from admission pin.`,
    );
  }
  if (handle.trustedRead !== pinned.trustedRead) {
    throw new RuntimeExecutionPolicyError(
      `Capability ${handle.id} handle trusted-read marker drifted from admission pin.`,
    );
  }
}

export function createFunctionHooksRuntime(
  options: CreateFunctionHooksRuntimeOptions,
): FunctionHooksRuntime {
  const cache = new CapabilityHandleCache();
  const executors = createExecutors(options);
  const unsubscribe =
    options.registry.subscribe?.((change) => {
      cache.delete(change.id);
    }) ?? (() => {});

  const resolveHandle = async (id: string): Promise<CompiledCapabilityHandle> => {
    const cached = cache.get(id);
    if (cached) return cached;
    const record = await options.registry.get(id);
    if (!record) {
      throw new RuntimeCapabilityNotFoundError(`Capability ${id} is not registered.`);
    }
    if (record.state !== "active") {
      throw new RuntimeCapabilityStateError(`Capability ${id} is ${record.state}.`);
    }
    return cache.set(compileHandle(record, options));
  };

  const invokeCapability = async (
    request: InvokeCapabilityRequest,
    context?: InvokeCapabilityContext,
  ): Promise<unknown> => {
    const capabilityId = nonEmptyString(request.id, "request.id");
    nonEmptyString(request.actionId, "request.actionId");
    assertNoCallTimeTierOverride(request);
    const handle = await resolveHandle(capabilityId);
    assertHandlePin(handle);
    const effectiveContext = normalizedContext(context);
    switch (handle.executor) {
      case "fast":
        return executors.fast.execute(handle, request, effectiveContext);
      case "guarded":
        return executors.guarded.execute(handle, request, effectiveContext);
      case "effect":
        return executors.effect.execute(handle, request, effectiveContext);
    }
  };

  return Object.freeze({
    searchCapabilities: (filter?: RuntimeCapabilityRegistryFilter) =>
      projectRuntimeCapabilityCatalog(options.registry, filter),
    resolveHandle,
    invokeCapability,
    clearHandleCache: (id?: string) => {
      if (id === undefined) {
        cache.clear();
        return;
      }
      cache.delete(id);
    },
    get cacheSize() {
      return cache.size;
    },
    close: async () => {
      unsubscribe();
      cache.clear();
    },
  });
}
