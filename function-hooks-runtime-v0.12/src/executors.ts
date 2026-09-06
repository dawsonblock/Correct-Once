import { capabilitySha256 } from "@function-hooks/capabilities";
import { callLockedEffectGateway } from "./effect-gateway-bridge.js";
import {
  RuntimeEffectExecutionDeniedError,
  RuntimeExecutionPolicyError,
  RuntimeIdempotencyConflictError,
  RuntimeNeedsReconciliationError,
  RuntimePolicyHookError,
} from "./errors.js";
import type {
  CompiledCapabilityHandle,
  InvokeCapabilityContext,
  InvokeCapabilityRequest,
  PureCapabilityHandler,
  RuntimePolicyContext,
  RuntimePolicyHook,
  RuntimeReceiptHooks,
} from "./types.js";

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function valueMap<T>(
  hooks: Readonly<Record<string, T>> | ReadonlyMap<string, T> | undefined,
): ReadonlyMap<string, T> {
  if (!hooks) return new Map<string, T>();
  return hooks instanceof Map ? hooks : new Map(Object.entries(hooks));
}

function requireSubject(
  handle: CompiledCapabilityHandle,
  context: InvokeCapabilityContext,
  reason: string,
): string {
  const subject = context.subject?.trim();
  if (!subject) {
    throw new RuntimeExecutionPolicyError(
      `Capability ${handle.id} requires a non-empty subject for ${reason}.`,
    );
  }
  return subject;
}

async function runPolicyHook(
  hooks: ReadonlyMap<string, RuntimePolicyHook>,
  handle: CompiledCapabilityHandle,
  request: InvokeCapabilityRequest,
  context: InvokeCapabilityContext,
): Promise<RuntimePolicyContext> {
  if (handle.requiresLightweightAuth) {
    requireSubject(handle, context, "lightweight auth");
  }
  const policyContext = Object.freeze({ handle, request, context });
  const hookId = handle.policyHookId;
  if (!hookId) {
    if (handle.requiresLightweightAuth) {
      throw new RuntimePolicyHookError(
        `Capability ${handle.id} requires lightweight auth but has no policy hook.`,
      );
    }
    return policyContext;
  }
  const hook = hooks.get(hookId);
  if (!hook) {
    throw new RuntimePolicyHookError(
      `Capability ${handle.id} references unknown policy hook ${hookId}.`,
    );
  }
  await hook(policyContext);
  return policyContext;
}

function effectArgs(input: unknown, capabilityId: string): Record<string, unknown> {
  if (input === undefined) return {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RuntimeEffectExecutionDeniedError(
      `EffectExecutor requires object args for capability ${capabilityId}.`,
    );
  }
  return input as Record<string, unknown>;
}

function directRequest(
  handle: CompiledCapabilityHandle,
  request: InvokeCapabilityRequest,
) {
  return {
    actionId: request.actionId,
    app: handle.app,
    capability: handle.capability,
    ...(request.input === undefined ? {} : { input: request.input }),
    ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
  };
}

function actionDigest(request: InvokeCapabilityRequest): string {
  return capabilitySha256({
    ...(request.input === undefined ? {} : { input: request.input }),
    ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
  });
}

function withCause<T extends Error>(error: T, cause: Error): T {
  Object.defineProperty(error, "cause", {
    value: cause,
    enumerable: false,
    configurable: true,
    writable: false,
  });
  return error;
}

function needsReconciliation(
  handle: CompiledCapabilityHandle,
  subject: string,
  idempotencyKey: string,
  stage: string,
  primary: Error,
  secondary?: Error,
): RuntimeNeedsReconciliationError {
  const detail =
    secondary === undefined
      ? primary.message
      : `${primary.message}; receipt error: ${secondary.message}`;
  return withCause(
    new RuntimeNeedsReconciliationError(
      `NEEDS_RECONCILIATION: Capability ${handle.id} subject=${subject} idempotencyKey=${idempotencyKey} may have executed but ${stage} failed: ${detail}`,
    ),
    secondary ?? primary,
  );
}

export class FastExecutor {
  readonly #policyHooks: ReadonlyMap<string, RuntimePolicyHook>;
  readonly #pureHandlers: ReadonlyMap<string, PureCapabilityHandler>;

  constructor(options: {
    readonly policyHooks?: Readonly<Record<string, RuntimePolicyHook>> | ReadonlyMap<string, RuntimePolicyHook>;
    readonly pureHandlers?: Readonly<Record<string, PureCapabilityHandler>> | ReadonlyMap<string, PureCapabilityHandler>;
  }) {
    this.#policyHooks = valueMap(options.policyHooks);
    this.#pureHandlers = valueMap(options.pureHandlers);
  }

  async execute(
    handle: CompiledCapabilityHandle,
    request: InvokeCapabilityRequest,
    context: InvokeCapabilityContext,
  ): Promise<unknown> {
    const policyContext = await runPolicyHook(this.#policyHooks, handle, request, context);
    if (handle.executionClass === "pure") {
      if (handle.route) {
        throw new RuntimeExecutionPolicyError(
          `Capability ${handle.id} is pure but still carries an external route.`,
        );
      }
      const pureHandlerId = handle.pureHandlerId;
      if (!pureHandlerId) {
        throw new RuntimeExecutionPolicyError(
          `Capability ${handle.id} is pure but has no pinned pure handler.`,
        );
      }
      const pureHandler = this.#pureHandlers.get(pureHandlerId);
      if (!pureHandler) {
        throw new RuntimeExecutionPolicyError(
          `Capability ${handle.id} references unknown pure handler ${pureHandlerId}.`,
        );
      }
      return pureHandler(policyContext);
    }

    if (!handle.directRouter) {
      throw new RuntimeExecutionPolicyError(
        `Capability ${handle.id} is missing a read-path router handle.`,
      );
    }
    return handle.directRouter.execute(directRequest(handle, request), context);
  }
}

export class EffectExecutor {
  readonly #target;
  readonly #policyHooks: ReadonlyMap<string, RuntimePolicyHook>;

  constructor(options: {
    readonly target: Parameters<typeof callLockedEffectGateway>[0];
    readonly policyHooks?: Readonly<Record<string, RuntimePolicyHook>> | ReadonlyMap<string, RuntimePolicyHook>;
  }) {
    this.#target = options.target;
    this.#policyHooks = valueMap(options.policyHooks);
  }

  async execute(
    handle: CompiledCapabilityHandle,
    request: InvokeCapabilityRequest,
    context: InvokeCapabilityContext,
  ): Promise<unknown> {
    await runPolicyHook(this.#policyHooks, handle, request, context);
    const admitted = handle.admitted.capability;
    const implementation = admitted.implementation;
    if (handle.executionClass !== "critical") {
      throw new RuntimeEffectExecutionDeniedError(
        `Capability ${handle.id} is ${handle.executionClass}; EffectExecutor is reserved for critical execution.`,
      );
    }
    if (implementation.kind !== "mcp") {
      throw new RuntimeEffectExecutionDeniedError(
        `Capability ${handle.id} is ${implementation.kind}; only admitted MCP capabilities are effect-routable in this scaffold.`,
      );
    }
    if (admitted.provenance.schemaDigest !== admitted.schemaHash) {
      throw new RuntimeEffectExecutionDeniedError(
        `Capability ${handle.id} failed schema digest pin validation.`,
      );
    }
    if (admitted.sideEffect === "destructive" && context.allowDestructive !== true) {
      throw new RuntimeEffectExecutionDeniedError(
        `Capability ${handle.id} is destructive and requires allowDestructive=true.`,
      );
    }
    const subject = requireSubject(handle, context, "critical effect execution");
    return callLockedEffectGateway(this.#target, {
      subject,
      server: implementation.server,
      tool: implementation.tool,
      args: effectArgs(request.input, handle.id),
      traceId: request.actionId,
      ...(context.approvalToken === undefined
        ? {}
        : { approvalToken: context.approvalToken }),
    });
  }
}

export class GuardedExecutor {
  readonly #policyHooks: ReadonlyMap<string, RuntimePolicyHook>;
  readonly #receipts: RuntimeReceiptHooks | undefined;
  readonly #idempotency = new Map<
    string,
    {
      readonly actionDigest: string;
      readonly promise: Promise<unknown>;
    }
  >();

  constructor(options: {
    readonly policyHooks?: Readonly<Record<string, RuntimePolicyHook>> | ReadonlyMap<string, RuntimePolicyHook>;
    readonly receipts?: RuntimeReceiptHooks;
  }) {
    this.#policyHooks = valueMap(options.policyHooks);
    this.#receipts = options.receipts;
  }

  async execute(
    handle: CompiledCapabilityHandle,
    request: InvokeCapabilityRequest,
    context: InvokeCapabilityContext,
  ): Promise<unknown> {
    const subject = requireSubject(handle, context, "guarded execution");
    const policyContext = await runPolicyHook(this.#policyHooks, handle, request, context);
    if (!request.idempotencyKey?.trim()) {
      throw new RuntimeExecutionPolicyError(
        `Capability ${handle.id} is guarded and requires a non-empty idempotencyKey.`,
      );
    }
    const receipts = this.#receipts;
    const onStart = receipts?.onStart;
    const onSuccess = receipts?.onSuccess;
    const onFailure = receipts?.onFailure;
    if (!onStart || !onSuccess || !onFailure) {
      throw new RuntimeExecutionPolicyError(
        `Capability ${handle.id} is guarded and requires receipt hooks.`,
      );
    }
    if (!handle.directRouter) {
      throw new RuntimeExecutionPolicyError(
        `Capability ${handle.id} is missing a guarded mutation router handle.`,
      );
    }
    const directRouter = handle.directRouter;
    const key = request.idempotencyKey.trim();
    const digest = actionDigest(request);
    const cacheKey = `${subject}\u0000${handle.id}\u0000${key}`;
    const existing = this.#idempotency.get(cacheKey);
    if (existing) {
      if (existing.actionDigest !== digest) {
        throw new RuntimeIdempotencyConflictError(
          `IDEMPOTENCY_CONFLICT: Capability ${handle.id} subject=${subject} idempotencyKey=${key} was reused with a different action digest.`,
        );
      }
      return existing.promise;
    }

    let executionStarted = false;
    const pending = (async (): Promise<unknown> => {
      await onStart(policyContext);
      let result: unknown;
      try {
        executionStarted = true;
        result = await directRouter.execute(directRequest(handle, request), context);
      } catch (error) {
        const wrapped = asError(error);
        try {
          await onFailure(
            Object.freeze({
              ...policyContext,
              error: wrapped,
            }),
          );
        } catch (receiptError) {
          throw needsReconciliation(
            handle,
            subject,
            key,
            "failure receipt persistence after the external attempt",
            wrapped,
            asError(receiptError),
          );
        }
        throw needsReconciliation(
          handle,
          subject,
          key,
          "external execution",
          wrapped,
        );
      }
      try {
        await onSuccess(
          Object.freeze({
            ...policyContext,
            result,
          }),
        );
      } catch (error) {
        throw needsReconciliation(
          handle,
          subject,
          key,
          "success receipt persistence after the external effect",
          asError(error),
        );
      }
      return result;
    })();
    this.#idempotency.set(cacheKey, {
      actionDigest: digest,
      promise: pending,
    });
    try {
      return await pending;
    } catch (error) {
      if (!executionStarted) {
        this.#idempotency.delete(cacheKey);
      }
      throw error;
    }
  }
}
