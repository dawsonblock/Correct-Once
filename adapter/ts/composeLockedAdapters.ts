/**
 * Composition lock: host mcp.call MUST be bound through EffectGateway.
 * Do not call createNodeGatewayAdapters with a raw mcpCall.
 *
 * Critical path (mandatory):
 *   const { mcpCall } = composeEffectLockedMcpOptions(effectGateway);
 *   const adapters = await createNodeGatewayAdapters({ ...roots, mcpCall });
 *   await createEffectLockedAgentGateway(createAgentGateway, { ...opts, adapters });
 *
 * createEffectLockedAgentGateway ALWAYS runs assertMcpCallIsEffectLocked first.
 * The brand Symbol is module-private (not Symbol.for) so external code cannot forge it
 * without monkeypatching this module.
 */
import {
  assertNoManualMcpRoutes,
  effectGatewayMcpCall,
  type EffectGatewayCallTool,
  type EffectGatewayHttpFacade,
  type ManualRouteLike,
  McpHostBridgeError,
} from "./effectGatewayMcpCall.js";

/** Module-private brand — do not export; not Symbol.for (not forgeable by name). */
const EFFECT_MCP_CALL_LOCK = Symbol("adapter.effectGatewayMcpCall.v1");

type LockedMcpCall = ((
  input: {
    readonly server: string;
    readonly tool: string;
    readonly args?: unknown;
    readonly actionId?: string;
    readonly metadata?: Readonly<Record<string, string>>;
  },
  context: { readonly origin: string },
) => Promise<unknown>) & { readonly [typeof EFFECT_MCP_CALL_LOCK]: true };

function resolveSubject(
  input: { readonly metadata?: Readonly<Record<string, string>> },
  context: { readonly origin: string },
): string {
  const fromMeta = input.metadata?.subject?.trim();
  if (fromMeta) return fromMeta;
  const origin = (context.origin || "").trim();
  if (origin) return origin;
  throw new McpHostBridgeError("mcp.call denied: missing subject (fail closed)");
}

/** Build the only allowed mcpCall implementation. */
export function createLockedMcpCall(
  effectGateway: EffectGatewayCallTool | EffectGatewayHttpFacade,
): LockedMcpCall {
  const locked = (async (input, context) => {
    const subject = resolveSubject(input, context);
    const args =
      input.args && typeof input.args === "object" && !Array.isArray(input.args)
        ? (input.args as Record<string, unknown>)
        : {};
    return effectGatewayMcpCall(effectGateway, {
      subject,
      server: input.server,
      tool: input.tool,
      args,
    });
  }) as LockedMcpCall;
  Object.defineProperty(locked, EFFECT_MCP_CALL_LOCK, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return locked;
}

/** Fail if adapters["mcp.call"] is missing or not our locked binder. */
export function assertMcpCallIsEffectLocked(adapters: {
  readonly ["mcp.call"]?: unknown;
}): void {
  const fn = adapters["mcp.call"] as LockedMcpCall | undefined;
  if (!fn || fn[EFFECT_MCP_CALL_LOCK] !== true) {
    throw new McpHostBridgeError(
      'composition lock failed: adapters["mcp.call"] must be createLockedMcpCall(effectGateway)',
    );
  }
}

/**
 * Host composition helper: force mcpCall through EffectGateway; refuse MCP manualRoutes.
 * Pass the returned mcpCall into createNodeGatewayAdapters({ ..., mcpCall }).
 * Then you MUST use createEffectLockedAgentGateway (not bare createAgentGateway).
 */
export function composeEffectLockedMcpOptions(
  effectGateway: EffectGatewayCallTool | EffectGatewayHttpFacade,
  manualRoutes?: readonly ManualRouteLike[],
): { mcpCall: LockedMcpCall } {
  assertNoManualMcpRoutes(manualRoutes);
  return { mcpCall: createLockedMcpCall(effectGateway) };
}

type AgentGatewayFactory = (options: { readonly adapters: { readonly ["mcp.call"]?: unknown } } & Record<string, unknown>) => Promise<unknown>;

/**
 * Mandatory critical-path entry: asserts the lock, then calls the host's createAgentGateway.
 * Skipping this and calling createAgentGateway directly is unsupported and fail-closed at review.
 */
export async function createEffectLockedAgentGateway(
  createAgentGateway: AgentGatewayFactory,
  options: { readonly adapters: { readonly ["mcp.call"]?: unknown } } & Record<string, unknown>,
): Promise<unknown> {
  assertMcpCallIsEffectLocked(options.adapters);
  return createAgentGateway(options);
}

/** Test helper: simulate plugging a raw transport — must fail assertMcpCallIsEffectLocked. */
export function rawTransportMcpCall(): (input: unknown, context: unknown) => Promise<unknown> {
  return async () => {
    throw new Error("raw MCP transport must never run");
  };
}
