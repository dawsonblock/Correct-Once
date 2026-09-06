import { createExecutionRouter, compileAdmittedCapabilityRoute } from "@function-hooks/router";
import { CapabilityHandleCache } from "./handle-cache.js";
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
  if (record.state !== "active") {
    throw new RuntimeCapabilityStateError(
      `Capability ${record.capability.capability.id} is not active.`,
    );
  }
  const route = compileAdmittedCapabilityRoute(record.capability.capability);
  const executor = executorFor(record);
  const fastRouter =
    executor === "fast"
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
    ...(record.capability.execution.policyHookId
      ? { policyHookId: record.capability.execution.policyHookId }
      : {}),
    requiresLightweightAuth: record.capability.execution.requiresLightweightAuth,
    trustedRead: record.capability.execution.trustedRead,
    stateVersion: record.stateVersion,
    admitted: record.capability,
    route,
    ...(fastRouter ? { fastRouter } : {}),
  });
}

function createExecutors(options: CreateFunctionHooksRuntimeOptions): RuntimeExecutors {
  const effect = new EffectExecutor({ target: options.effectGateway });
  return {
    fast: new FastExecutor({
      ...(options.policyHooks === undefined ? {} : { policyHooks: options.policyHooks }),
    }),
    guarded: new GuardedExecutor({
      effect,
      ...(options.policyHooks === undefined ? {} : { policyHooks: options.policyHooks }),
      ...(options.receipts === undefined ? {} : { receipts: options.receipts }),
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
    const handle = await resolveHandle(capabilityId);
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
