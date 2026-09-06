import { RuntimeExecutionPolicyError } from "./errors.js";

const EFFECT_GATEWAY_CLIENT = Symbol("function-hooks-runtime.effect-gateway-client.v0.13");

export interface EffectGatewayCallTool {
  (input: {
    readonly subject: string;
    readonly server: string;
    readonly tool: string;
    readonly arguments?: Record<string, unknown>;
    readonly trace_id?: string;
    readonly idempotency_key?: string;
    readonly action_id?: string;
    readonly approval_token?: string;
  }): Promise<unknown>;
}

export interface EffectGatewayHttpFacade {
  readonly baseUrl: string;
  readonly bearerToken: string;
}

interface CallToolTransport {
  readonly kind: "call-tool";
  readonly callTool: EffectGatewayCallTool;
}

interface HttpTransport {
  readonly kind: "http";
  readonly facade: EffectGatewayHttpFacade;
}

export interface EffectGatewayClient {
  readonly transport: CallToolTransport | HttpTransport;
  readonly [EFFECT_GATEWAY_CLIENT]: true;
}

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RuntimeExecutionPolicyError(`${field} must be a non-empty string.`);
  }
  return value;
}

export function createEffectGatewayClient(
  target: EffectGatewayCallTool | EffectGatewayHttpFacade,
): EffectGatewayClient {
  const transport =
    typeof target === "function"
      ? Object.freeze({
          kind: "call-tool" as const,
          callTool: target,
        })
      : Object.freeze({
          kind: "http" as const,
          facade: Object.freeze({
            baseUrl: nonEmpty(target.baseUrl, "effectGateway.baseUrl"),
            bearerToken: nonEmpty(target.bearerToken, "effectGateway.bearerToken"),
          }),
        });
  return Object.freeze({
    transport,
    [EFFECT_GATEWAY_CLIENT]: true as const,
  });
}

function assertEffectGatewayClient(value: unknown): asserts value is EffectGatewayClient {
  if (!value || typeof value !== "object" || (value as EffectGatewayClient)[EFFECT_GATEWAY_CLIENT] !== true) {
    throw new RuntimeExecutionPolicyError(
      "effectGateway must be created by createEffectGatewayClient(...).",
    );
  }
}

export async function callLockedEffectGateway(
  target: EffectGatewayClient,
  input: {
    readonly subject: string;
    readonly server: string;
    readonly tool: string;
    readonly args?: Record<string, unknown>;
    readonly traceId?: string;
    readonly idempotencyKey?: string;
    readonly actionId?: string;
    readonly approvalToken?: string;
  },
): Promise<unknown> {
  assertEffectGatewayClient(target);
  if (target.transport.kind === "call-tool") {
    return target.transport.callTool({
      subject: input.subject,
      server: input.server,
      tool: input.tool,
      arguments: input.args ?? {},
      ...(input.traceId === undefined ? {} : { trace_id: input.traceId }),
      ...(input.idempotencyKey === undefined ? {} : { idempotency_key: input.idempotencyKey }),
      ...(input.actionId === undefined ? {} : { action_id: input.actionId }),
      ...(input.approvalToken === undefined ? {} : { approval_token: input.approvalToken }),
    });
  }

  const url = `${target.transport.facade.baseUrl.replace(/\/$/, "")}/gateway/tool-call`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${target.transport.facade.bearerToken}`,
    },
    body: JSON.stringify({
      subject: input.subject,
      server: input.server,
      tool: input.tool,
      arguments: input.args ?? {},
      trace_id: input.traceId,
      idempotency_key: input.idempotencyKey,
      action_id: input.actionId,
      approval_token: input.approvalToken,
    }),
  });
  if (!res.ok) {
    throw new RuntimeExecutionPolicyError(
      `EffectGateway HTTP facade denied/failed: ${res.status} ${await res.text()}`,
    );
  }
  return res.json();
}
