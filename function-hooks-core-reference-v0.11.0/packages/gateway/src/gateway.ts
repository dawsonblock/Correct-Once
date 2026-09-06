import { createKernel, type KernelOptions } from "@function-hooks/core";
import { InMemoryActionReceiptStore, registerActionReceiptHooks, type ActionReceiptStore } from "@function-hooks/assurance";
import { createGatewayBlueprint } from "./blueprint.js";
import { registerGatewayExecutionAuditHooks, registerGatewayExecutionHooks } from "./execution.js";
import { denyAllGatewayAuthorizer, registerGatewayPolicyHooks } from "./policy.js";
import { DEFAULT_RECEIPT_EVENTS, type AgentGateway, type GatewayAdapters, type GatewayApprovalProvider, type GatewayAuditSink, type GatewayAuthorizer, type GatewayEventName, type GatewayEvents } from "./types.js";

export interface CreateAgentGatewayOptions extends KernelOptions<GatewayEvents> {
  readonly adapters: GatewayAdapters;
  /** Defaults to deny-all. Callers must deliberately install an authorization policy. */
  readonly authorizer?: GatewayAuthorizer;
  readonly approval?: GatewayApprovalProvider;
  readonly audit?: GatewayAuditSink;
  readonly receipts?: false | {
    readonly store?: ActionReceiptStore;
    readonly events?: readonly GatewayEventName[];
  };
}

export async function createAgentGateway(options: CreateAgentGatewayOptions): Promise<AgentGateway> {
  const builder = createKernel<GatewayEvents>({ ...(options.trace ? { trace: options.trace } : {}), ...(options.defaultTimeoutMs === undefined ? {} : { defaultTimeoutMs: options.defaultTimeoutMs }) });
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
  const dispatch = <K extends GatewayEventName>(event: K, input: GatewayEvents[K]["input"], dispatchOptions: { readonly origin?: string; readonly signal?: AbortSignal; readonly timeoutMs?: number } = {}): Promise<GatewayEvents[K]["result"]> => runtime.dispatch(event, input, dispatchOptions);
  return Object.freeze({ runtime, engine, dispatch, close: () => runtime.close() });
}
