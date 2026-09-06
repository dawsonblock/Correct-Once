import { createBlueprint, type EngineBlueprint } from "@function-hooks/core";
import type { GatewayEvents } from "./types.js";
import { GatewayAdapterUnavailableError } from "./errors.js";

function unavailable(event: string): never {
  throw new GatewayAdapterUnavailableError(`Gateway event ${event} reached the base implementation without an execution adapter.`);
}

export function createGatewayBlueprint(): EngineBlueprint<GatewayEvents> {
  return createBlueprint<GatewayEvents>({
    "mcp.call": { invoke: () => unavailable("mcp.call") },
    "browser.call": { invoke: () => unavailable("browser.call") },
    "desktop.call": { invoke: () => unavailable("desktop.call") },
    "fs.read": { invoke: () => unavailable("fs.read") },
    "fs.write": { invoke: () => unavailable("fs.write") },
    "process.exec": { invoke: () => unavailable("process.exec") },
    "network.request": { invoke: () => unavailable("network.request") },
  });
}
