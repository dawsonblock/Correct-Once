import { createBlueprint } from "@function-hooks/core";
import { GatewayAdapterUnavailableError } from "./errors.js";
function unavailable(event) {
    throw new GatewayAdapterUnavailableError(`Gateway event ${event} reached the base implementation without an execution adapter.`);
}
export function createGatewayBlueprint() {
    return createBlueprint({
        "mcp.call": { invoke: () => unavailable("mcp.call") },
        "browser.call": { invoke: () => unavailable("browser.call") },
        "desktop.call": { invoke: () => unavailable("desktop.call") },
        "fs.read": { invoke: () => unavailable("fs.read") },
        "fs.write": { invoke: () => unavailable("fs.write") },
        "process.exec": { invoke: () => unavailable("process.exec") },
        "network.request": { invoke: () => unavailable("network.request") },
    });
}
//# sourceMappingURL=blueprint.js.map