import type { KernelBuilder } from "@function-hooks/core";
import { GatewayAdapterUnavailableError } from "./errors.js";
import { GATEWAY_EVENTS, type GatewayAdapters, type GatewayAuditSink, type GatewayEvents } from "./types.js";

const noopAudit: GatewayAuditSink = () => {};

export function registerGatewayExecutionAuditHooks(builder: KernelBuilder<GatewayEvents>, order: number, audit: GatewayAuditSink = noopAudit): void {
  for (const event of GATEWAY_EVENTS) {
    builder.on("gateway-execution-audit", order, event, async (_engine, input, next) => {
      await audit({ at: Date.now(), phase: "execution.start", event, origin: next.origin, actionId: input.actionId, input });
      try {
        const result = await next(input as never);
        await audit({ at: Date.now(), phase: "execution.success", event, origin: next.origin, actionId: input.actionId, input, ...(result === undefined ? {} : { result }) });
        return result;
      } catch (error) {
        await audit({ at: Date.now(), phase: "execution.failure", event, origin: next.origin, actionId: input.actionId, input, error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    });
  }
}

export function registerGatewayExecutionHooks(builder: KernelBuilder<GatewayEvents>, order: number, adapters: GatewayAdapters): void {
  for (const event of GATEWAY_EVENTS) {
    builder.on("gateway-executor", order, event, async (engine, input, next) => {
      const adapter = adapters[event] as ((input: unknown, context: unknown) => unknown | Promise<unknown>) | undefined;
      if (!adapter) throw new GatewayAdapterUnavailableError(`No host adapter is configured for ${event}.`);
      return adapter(input, Object.freeze({ event, origin: next.origin, signal: next.signal, engine })) as never;
    });
  }
}
