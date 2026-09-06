import { createKernel } from "@function-hooks/core";
import { InMemoryActionReceiptStore, registerActionReceiptHooks } from "@function-hooks/assurance";
import { createGatewayBlueprint } from "./blueprint.js";
import { registerGatewayExecutionAuditHooks, registerGatewayExecutionHooks } from "./execution.js";
import { denyAllGatewayAuthorizer, registerGatewayPolicyHooks } from "./policy.js";
import { DEFAULT_RECEIPT_EVENTS } from "./types.js";
export async function createAgentGateway(options) {
    const builder = createKernel({ ...(options.trace ? { trace: options.trace } : {}), ...(options.defaultTimeoutMs === undefined ? {} : { defaultTimeoutMs: options.defaultTimeoutMs }) });
    builder.defineEngine(createGatewayBlueprint());
    const audit = options.audit;
    registerGatewayPolicyHooks(builder, 0, options.authorizer ?? denyAllGatewayAuthorizer(), options.approval, audit);
    if (options.receipts !== false) {
        const receiptOptions = options.receipts ?? {};
        registerActionReceiptHooks(builder, 20, receiptOptions.store ?? new InMemoryActionReceiptStore(), {
            events: new Set(receiptOptions.events ?? DEFAULT_RECEIPT_EVENTS),
        });
    }
    registerGatewayExecutionAuditHooks(builder, 40, audit);
    registerGatewayExecutionHooks(builder, 100, options.adapters);
    const runtime = builder.build();
    const engine = await runtime.start();
    const dispatch = (event, input, dispatchOptions = {}) => runtime.dispatch(event, input, dispatchOptions);
    return Object.freeze({ runtime, engine, dispatch, close: () => runtime.close() });
}
//# sourceMappingURL=gateway.js.map