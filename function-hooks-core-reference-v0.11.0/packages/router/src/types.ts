import type { AgentGateway, GatewayEventName, GatewayEvents } from "@function-hooks/gateway";

export type ExecutionBackend = "mcp" | "api" | "browser" | "desktop" | "local";

export interface RoutedActionRequest {
  readonly actionId: string;
  readonly app: string;
  readonly capability: string;
  readonly input?: unknown;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface RouterDispatchOptions {
  /** Diagnostic kernel-origin label only. This is not authenticated identity. */
  readonly origin?: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export type RoutedGatewayInput<K extends GatewayEventName> = Omit<GatewayEvents[K]["input"], "actionId">;

export interface CapabilityRoute<K extends GatewayEventName = GatewayEventName> {
  readonly app: string;
  readonly capability: string;
  readonly backend: ExecutionBackend;
  readonly event: K;
  /** Trusted route metadata merged after caller metadata. Used by admitted capability compilation. */
  readonly trustedMetadata?: Readonly<Record<string, string>>;
  /** Builds only the backend-specific input. The router owns and injects actionId. */
  readonly build: (request: Readonly<RoutedActionRequest>) => RoutedGatewayInput<K> | Promise<RoutedGatewayInput<K>>;
}

export type AnyCapabilityRoute = {
  [K in GatewayEventName]: CapabilityRoute<K>;
}[GatewayEventName];

export interface CapabilityRouteDescriptor {
  readonly app: string;
  readonly capability: string;
  readonly backend: ExecutionBackend;
  readonly event: GatewayEventName;
}

export interface ExecutionRouter {
  readonly gateway: AgentGateway;
  execute(request: RoutedActionRequest, options?: RouterDispatchOptions): Promise<unknown>;
  hasRoute(app: string, capability: string): boolean;
  listRoutes(): readonly CapabilityRouteDescriptor[];
}
