export interface EffectGatewayCallTool {
  (input: {
    subject: string;
    server: string;
    tool: string;
    arguments?: Record<string, unknown>;
    trace_id?: string;
    approval_token?: string;
  }): Promise<unknown>;
}

export interface EffectGatewayHttpFacade {
  readonly baseUrl: string;
  readonly bearerToken: string;
}

export async function callLockedEffectGateway(
  target: EffectGatewayCallTool | EffectGatewayHttpFacade,
  input: {
    subject: string;
    server: string;
    tool: string;
    args?: Record<string, unknown>;
    traceId?: string;
    approvalToken?: string;
  },
): Promise<unknown> {
  const moduleUrl = new URL("../../adapter/ts/effectGatewayMcpCall.ts", import.meta.url);
  const module = (await import(moduleUrl.href)) as {
    effectGatewayMcpCall: (
      target: EffectGatewayCallTool | EffectGatewayHttpFacade,
      input: {
        subject: string;
        server: string;
        tool: string;
        args?: Record<string, unknown>;
        traceId?: string;
        approvalToken?: string;
      },
    ) => Promise<unknown>;
  };
  return module.effectGatewayMcpCall(target, input);
}
