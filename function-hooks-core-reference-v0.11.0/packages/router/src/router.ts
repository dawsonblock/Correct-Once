import { GATEWAY_EVENTS, type GatewayEventName, type GatewayInput } from "@function-hooks/gateway";
import { CapabilityRouteNotFoundError, DuplicateCapabilityRouteError, InvalidCapabilityRouteError, InvalidRoutedActionError } from "./errors.js";
import type { AnyCapabilityRoute, CapabilityRouteDescriptor, ExecutionRouter, RoutedActionRequest, RouterDispatchOptions } from "./types.js";

const ROUTER_METADATA_APP = "function-hooks.router.app";
const ROUTER_METADATA_CAPABILITY = "function-hooks.router.capability";
const ROUTER_METADATA_BACKEND = "function-hooks.router.backend";

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new InvalidRoutedActionError(`${field} must be a non-empty string.`);
  return value;
}
function routeKey(app: string, capability: string): string { return `${app}\u0000${capability}`; }
const gatewayEvents = new Set<GatewayEventName>(GATEWAY_EVENTS);
function backendAcceptsEvent(backend: string, event: GatewayEventName): boolean {
  if (backend === "mcp") return event === "mcp.call";
  if (backend === "api") return event === "network.request";
  if (backend === "browser") return event === "browser.call";
  if (backend === "desktop") return event === "desktop.call";
  if (backend === "local") return event === "fs.read" || event === "fs.write" || event === "process.exec";
  return false;
}
function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidCapabilityRouteError(`${field} must be an object.`);
  return value as Record<string, unknown>;
}

export interface CreateExecutionRouterOptions {
  readonly gateway: ExecutionRouter["gateway"];
  readonly routes: readonly AnyCapabilityRoute[];
}

export function createExecutionRouter(options: CreateExecutionRouterOptions): ExecutionRouter {
  const routes = new Map<string, AnyCapabilityRoute>();
  const descriptors: CapabilityRouteDescriptor[] = [];
  for (const route of options.routes) {
    if (!route || typeof route !== "object") throw new InvalidCapabilityRouteError("Capability route must be an object.");
    const app = nonEmpty(route.app, "route.app");
    const capability = nonEmpty(route.capability, "route.capability");
    if (typeof route.build !== "function") throw new InvalidCapabilityRouteError(`Route ${app}/${capability} must define build().`);
    if (!gatewayEvents.has(route.event)) throw new InvalidCapabilityRouteError(`Route ${app}/${capability} references unknown gateway event ${String(route.event)}.`);
    if (!backendAcceptsEvent(route.backend, route.event)) throw new InvalidCapabilityRouteError(`Route ${app}/${capability} backend ${String(route.backend)} is incompatible with ${route.event}.`);
    const key = routeKey(app, capability);
    if (routes.has(key)) throw new DuplicateCapabilityRouteError(`Duplicate capability route ${app}/${capability}.`);
    routes.set(key, route);
    descriptors.push(Object.freeze({ app, capability, backend: route.backend, event: route.event }));
  }

  const execute = async (request: RoutedActionRequest, dispatchOptions: RouterDispatchOptions = {}): Promise<unknown> => {
    if (!request || typeof request !== "object") throw new InvalidRoutedActionError("Routed action request must be an object.");
    const actionId = nonEmpty(request.actionId, "actionId");
    const app = nonEmpty(request.app, "app");
    const capability = nonEmpty(request.capability, "capability");
    if (request.metadata !== undefined) { for (const [key, value] of Object.entries(request.metadata)) { nonEmpty(key, "metadata key"); if (typeof value !== "string") throw new InvalidRoutedActionError(`metadata.${key} must be a string.`); } }
    const route = routes.get(routeKey(app, capability));
    if (!route) throw new CapabilityRouteNotFoundError(`No capability route is configured for ${app}/${capability}.`);
    const built = object(await route.build(Object.freeze({ ...request })), `route ${app}/${capability} build result`);
    if (Object.prototype.hasOwnProperty.call(built, "actionId")) {
      throw new InvalidCapabilityRouteError(`Route ${app}/${capability} attempted to provide actionId; action identity is owned by the router.`);
    }
    const routeMetadata = built.metadata === undefined ? {} : object(built.metadata, `route ${app}/${capability} metadata`);
    const metadata: Record<string, string> = {};
    for (const [key, value] of Object.entries(routeMetadata)) {
      if (typeof value !== "string") throw new InvalidCapabilityRouteError(`Route metadata ${key} must be a string.`);
      metadata[key] = value;
    }
    for (const [key, value] of Object.entries(request.metadata ?? {})) metadata[key] = value;
    for (const [key, value] of Object.entries(route.trustedMetadata ?? {})) {
      nonEmpty(key, "trusted metadata key");
      if (typeof value !== "string") throw new InvalidCapabilityRouteError(`Trusted route metadata ${key} must be a string.`);
      metadata[key] = value;
    }
    // Router-owned provenance labels cannot be forged by either the request or route builder.
    metadata[ROUTER_METADATA_APP] = app;
    metadata[ROUTER_METADATA_CAPABILITY] = capability;
    metadata[ROUTER_METADATA_BACKEND] = route.backend;
    const effective = Object.freeze({ ...built, actionId, metadata: Object.freeze(metadata) }) as GatewayInput;
    return options.gateway.dispatch(route.event as GatewayEventName, effective as never, dispatchOptions);
  };

  return Object.freeze({
    gateway: options.gateway,
    execute,
    hasRoute: (app: string, capability: string) => routes.has(routeKey(app, capability)),
    listRoutes: () => Object.freeze([...descriptors]),
  });
}
