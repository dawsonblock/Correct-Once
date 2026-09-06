import { GatewayAdapterUnavailableError } from "./errors.js";
import { GATEWAY_EVENTS } from "./types.js";
const noopAudit = () => { };
export function registerGatewayExecutionAuditHooks(builder, order, audit = noopAudit) {
    for (const event of GATEWAY_EVENTS) {
        builder.on("gateway-execution-audit", order, event, async (_engine, input, next) => {
            await audit({ at: Date.now(), phase: "execution.start", event, origin: next.origin, actionId: input.actionId, input });
            try {
                const result = await next(input);
                await audit({ at: Date.now(), phase: "execution.success", event, origin: next.origin, actionId: input.actionId, input, ...(result === undefined ? {} : { result }) });
                return result;
            }
            catch (error) {
                await audit({ at: Date.now(), phase: "execution.failure", event, origin: next.origin, actionId: input.actionId, input, error: error instanceof Error ? error.message : String(error) });
                throw error;
            }
        });
    }
}
export function registerGatewayExecutionHooks(builder, order, adapters) {
    for (const event of GATEWAY_EVENTS) {
        builder.on("gateway-executor", order, event, async (engine, input, next) => {
            const adapter = adapters[event];
            if (!adapter)
                throw new GatewayAdapterUnavailableError(`No host adapter is configured for ${event}.`);
            return adapter(input, Object.freeze({ event, origin: next.origin, signal: next.signal, engine }));
        });
    }
}
//# sourceMappingURL=execution.js.map