/**
 * Host mcpCall bridge: MUST invoke A EffectGateway.call_tool (or HTTP facade).
 * Never call raw MCP transport. Refuse manualRoutes that target MCP.
 *
 * A symbols (effect-fabric 0.2.11):
 *   EffectGateway.call_tool(subject, server, tool, arguments, ...)
 *   create_gateway_app -> POST /gateway/tool-call  (gateway_api.py)
 *
 * B: createExecutionRouterFromRegistry compiles admitted MCP routes; do not
 * supply manualRoutes with backend "mcp" / event "mcp.call".
 */

export type EffectGatewayCallTool = (input: {
  subject: string;
  server: string;
  tool: string;
  arguments?: Record<string, unknown>;
  trace_id?: string;
  idempotency_key?: string;
  action_id?: string;
  approval_token?: string;
}) => Promise<unknown>;

export type EffectGatewayHttpFacade = {
  /** Base URL of create_gateway_app(); posts to /gateway/tool-call */
  baseUrl: string;
  bearerToken: string;
};

export type ManualRouteLike = {
  backend?: string;
  event?: string;
  app?: string;
  capability?: string;
};

export class McpHostBridgeError extends Error {}

/** Refuse any manual route that would dispatch MCP outside EffectGateway. */
export function assertNoManualMcpRoutes(
  manualRoutes: readonly ManualRouteLike[] | undefined,
): void {
  if (!manualRoutes || manualRoutes.length === 0) return;
  for (const route of manualRoutes) {
    const backend = route.backend;
    const event = route.event;
    if (backend === "mcp" || event === "mcp.call") {
      throw new McpHostBridgeError(
        `refuse manualRoutes for MCP (${route.app}/${route.capability}): ` +
          "MCP must go through EffectGateway.call_tool / HTTP facade, not raw gateway adapters",
      );
    }
  }
}

/**
 * Host mcpCall implementation: always EffectGateway.call_tool or HTTP facade.
 * Never forwards to a raw MCP SDK / transport.
 */
export async function effectGatewayMcpCall(
  target: EffectGatewayCallTool | EffectGatewayHttpFacade,
  input: {
    subject: string;
    server: string;
    tool: string;
    args?: Record<string, unknown>;
    traceId?: string;
    idempotencyKey?: string;
    actionId?: string;
    approvalToken?: string;
  },
): Promise<unknown> {
  if (typeof target === "function") {
    return target({
      subject: input.subject,
      server: input.server,
      tool: input.tool,
      arguments: input.args ?? {},
      trace_id: input.traceId,
      idempotency_key: input.idempotencyKey,
      action_id: input.actionId,
      approval_token: input.approvalToken,
    });
  }

  const url = `${target.baseUrl.replace(/\/$/, "")}/gateway/tool-call`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${target.bearerToken}`,
    },
    body: JSON.stringify({
      subject: input.subject,
      server: input.server,
      tool: input.tool,
      arguments: input.args ?? {},
      trace_id: input.traceId,
      idempotency_key: input.idempotencyKey,
      action_id: input.actionId,
      // approval_token may be sent over the authenticated facade; never embed in schemas/receipts.
      approval_token: input.approvalToken,
    }),
  });
  if (!res.ok) {
    throw new McpHostBridgeError(
      `EffectGateway HTTP facade denied/failed: ${res.status} ${await res.text()}`,
    );
  }
  return res.json();
}
