import { callLockedEffectGateway } from "./effect-gateway-bridge.js";
import {
  RuntimeEffectExecutionDeniedError,
  RuntimeExecutionPolicyError,
  RuntimePolicyHookError,
} from "./errors.js";
import type {
  CompiledCapabilityHandle,
  InvokeCapabilityContext,
  InvokeCapabilityRequest,
  RuntimePolicyContext,
  RuntimePolicyHook,
  RuntimeReceiptHooks,
} from "./types.js";

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function hookMap(
  hooks: Readonly<Record<string, RuntimePolicyHook>> | ReadonlyMap<string, RuntimePolicyHook> | undefined,
): ReadonlyMap<string, RuntimePolicyHook> {
  if (!hooks) return new Map<string, RuntimePolicyHook>();
  return hooks instanceof Map ? hooks : new Map(Object.entries(hooks));
}

async function runPolicyHook(
  hooks: ReadonlyMap<string, RuntimePolicyHook>,
  handle: CompiledCapabilityHandle,
  request: InvokeCapabilityRequest,
  context: InvokeCapabilityContext,
): Promise<RuntimePolicyContext> {
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

export class FastExecutor {
  readonly #policyHooks: ReadonlyMap<string, RuntimePolicyHook>;

  constructor(options: {
    readonly policyHooks?: Readonly<Record<string, RuntimePolicyHook>> | ReadonlyMap<string, RuntimePolicyHook>;
  }) {
    this.#policyHooks = hookMap(options.policyHooks);
  }

  async execute(
    handle: CompiledCapabilityHandle,
    request: InvokeCapabilityRequest,
    context: InvokeCapabilityContext,
  ): Promise<unknown> {
    await runPolicyHook(this.#policyHooks, handle, request, context);
    if (!handle.fastRouter) {
      throw new RuntimeExecutionPolicyError(
        `Capability ${handle.id} is missing a fast-path router handle.`,
      );
    }
    return handle.fastRouter.execute(
      {
        actionId: request.actionId,
        app: handle.app,
        capability: handle.capability,
        ...(request.input === undefined ? {} : { input: request.input }),
        ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
      },
      context,
    );
  }
}

export class EffectExecutor {
  readonly #target;

  constructor(options: {
    readonly target: Parameters<typeof callLockedEffectGateway>[0];
  }) {
    this.#target = options.target;
  }

  async execute(
    handle: CompiledCapabilityHandle,
    request: InvokeCapabilityRequest,
    context: InvokeCapabilityContext,
  ): Promise<unknown> {
    const admitted = handle.admitted.capability;
    const implementation = admitted.implementation;
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
    const subject = context.subject?.trim();
    if (!subject) {
      throw new RuntimeEffectExecutionDeniedError(
        `Capability ${handle.id} requires an authority subject for Effect execution.`,
      );
    }
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
  readonly #effect: EffectExecutor;
  readonly #policyHooks: ReadonlyMap<string, RuntimePolicyHook>;
  readonly #receipts: RuntimeReceiptHooks | undefined;
  readonly #idempotency = new Map<string, Promise<unknown>>();

  constructor(options: {
    readonly effect: EffectExecutor;
    readonly policyHooks?: Readonly<Record<string, RuntimePolicyHook>> | ReadonlyMap<string, RuntimePolicyHook>;
    readonly receipts?: RuntimeReceiptHooks;
  }) {
    this.#effect = options.effect;
    this.#policyHooks = hookMap(options.policyHooks);
    this.#receipts = options.receipts;
  }

  async execute(
    handle: CompiledCapabilityHandle,
    request: InvokeCapabilityRequest,
    context: InvokeCapabilityContext,
  ): Promise<unknown> {
    const policyContext = await runPolicyHook(this.#policyHooks, handle, request, context);
    const run = async (): Promise<unknown> => {
      await this.#receipts?.onStart?.(policyContext);
      try {
        const result = await this.#effect.execute(handle, request, context);
        await this.#receipts?.onSuccess?.(
          Object.freeze({
            ...policyContext,
            result,
          }),
        );
        return result;
      } catch (error) {
        const wrapped = asError(error);
        await this.#receipts?.onFailure?.(
          Object.freeze({
            ...policyContext,
            error: wrapped,
          }),
        );
        throw wrapped;
      }
    };

    const key = request.idempotencyKey?.trim();
    if (!key) return run();

    const cacheKey = `${handle.id}\u0000${key}`;
    const existing = this.#idempotency.get(cacheKey);
    if (existing) return existing;

    const pending = run();
    this.#idempotency.set(cacheKey, pending);
    try {
      return await pending;
    } catch (error) {
      this.#idempotency.delete(cacheKey);
      throw error;
    }
  }
}
