import { immutableEvent } from "@function-hooks/core";
import { GatewayApprovalDeniedError, GatewayApprovalRequiredError, GatewayDeniedError, GatewayInvalidRewriteError } from "./errors.js";
import { GATEWAY_EVENTS } from "./types.js";
import { validateGatewayInput } from "./validate.js";
const noopAudit = () => { };
export function denyAllGatewayAuthorizer(reason = "No gateway authorization policy was configured.") {
    return () => ({ effect: "deny", reason });
}
export function allowAllGatewayAuthorizer() {
    return () => ({ effect: "allow" });
}
export function createGatewayAllowlistAuthorizer(policy) {
    // Snapshot all authority-bearing configuration at construction time. The public
    // types are readonly, but JavaScript callers can still mutate their original
    // arrays/objects after this function returns. Live references would silently
    // change authorization policy underneath an already-created gateway.
    const events = new Set(policy.events);
    const profiles = new Set(policy.processProfiles ?? []);
    const commands = new Set(policy.processCommands ?? []);
    const networkOrigins = new Set(policy.networkOrigins ?? []);
    const browserOps = new Set(policy.browserOperations ?? []);
    const approvals = new Set(policy.requireApprovalFor ?? []);
    const origins = new Map();
    for (const event of GATEWAY_EVENTS) {
        const values = policy.origins?.[event];
        if (values)
            origins.set(event, new Set(values));
    }
    const mcpTools = new Map();
    for (const [server, tools] of Object.entries(policy.mcpTools ?? {}))
        mcpTools.set(server, new Set(tools));
    const desktopOperations = new Map();
    for (const [application, operations] of Object.entries(policy.desktopOperations ?? {}))
        desktopOperations.set(application, new Set(operations));
    return (context) => {
        if (!events.has(context.event))
            return { effect: "deny", reason: `Event ${context.event} is not allowlisted.` };
        const allowedOrigins = origins.get(context.event);
        if (allowedOrigins && !allowedOrigins.has(context.origin))
            return { effect: "deny", reason: `Origin label ${context.origin} is not allowed for ${context.event}.` };
        const input = context.input;
        if (context.event === "process.exec") {
            if (typeof input.profile === "string") {
                if (!profiles.has(input.profile))
                    return { effect: "deny", reason: `Process profile ${input.profile} is not allowlisted.` };
            }
            else if (!commands.has(String(input.command))) {
                return { effect: "deny", reason: `Legacy process command ${String(input.command)} is not allowlisted.` };
            }
        }
        if (context.event === "network.request") {
            let origin;
            try {
                origin = new URL(String(input.url)).origin;
            }
            catch {
                return { effect: "deny", reason: "Network URL is invalid." };
            }
            if (!networkOrigins.has(origin))
                return { effect: "deny", reason: `Network origin ${origin} is not allowlisted.` };
        }
        if (context.event === "mcp.call") {
            const server = String(input.server);
            const tool = String(input.tool);
            if (!mcpTools.get(server)?.has(tool))
                return { effect: "deny", reason: `MCP tool ${server}/${tool} is not allowlisted.` };
        }
        if (context.event === "browser.call" && !browserOps.has(String(input.operation)))
            return { effect: "deny", reason: `Browser operation ${String(input.operation)} is not allowlisted.` };
        if (context.event === "desktop.call") {
            const application = String(input.application);
            const operation = String(input.operation);
            if (!desktopOperations.get(application)?.has(operation))
                return { effect: "deny", reason: `Desktop operation ${application}/${operation} is not allowlisted.` };
        }
        return { effect: "allow", ...(approvals.has(context.event) ? { approval: "required" } : {}) };
    };
}
export function registerGatewayPolicyHooks(builder, order, authorizer, approval, audit = noopAudit) {
    for (const event of GATEWAY_EVENTS) {
        builder.on("gateway-policy", order, event, async (_engine, input, next) => {
            validateGatewayInput(event, input);
            const context = Object.freeze({ event, origin: next.origin, input: input });
            const decision = await authorizer(context);
            if (!decision || (decision.effect !== "allow" && decision.effect !== "deny"))
                throw new GatewayDeniedError(`Authorization policy returned an invalid decision for ${event}.`);
            if (decision.effect === "deny") {
                await audit({ at: Date.now(), phase: "policy.denied", event, origin: next.origin, actionId: input.actionId, input, ...(decision.reason ? { reason: decision.reason } : {}) });
                throw new GatewayDeniedError(decision.reason ?? `Gateway policy denied ${event}.`);
            }
            // Snapshot policy output before approval or lower hooks can observe it.
            // `readonly` is compile-time only; without this clone/freeze an approval
            // provider (or retained policy reference) could mutate an already-validated
            // rewrite before execution.
            const effective = immutableEvent((decision.rewrite ?? input));
            validateGatewayInput(event, effective);
            if (effective.actionId !== input.actionId) {
                const reason = `Authorization policy attempted to change immutable actionId ${input.actionId} to ${effective.actionId}.`;
                await audit({ at: Date.now(), phase: "policy.denied", event, origin: next.origin, actionId: input.actionId, input, reason });
                throw new GatewayInvalidRewriteError(reason);
            }
            if (decision.approval === "required") {
                if (!approval) {
                    await audit({ at: Date.now(), phase: "approval.denied", event, origin: next.origin, actionId: effective.actionId, input: effective, reason: "Approval provider is unavailable." });
                    throw new GatewayApprovalRequiredError(`Gateway action ${event} requires approval, but no approval provider is configured.`);
                }
                const approved = await approval(Object.freeze({ event, origin: next.origin, input: effective, signal: next.signal, ...(decision.reason ? { reason: decision.reason } : {}) }));
                if (!approved) {
                    await audit({ at: Date.now(), phase: "approval.denied", event, origin: next.origin, actionId: effective.actionId, input: effective, ...(decision.reason ? { reason: decision.reason } : {}) });
                    throw new GatewayApprovalDeniedError(decision.reason ?? `Approval was denied for ${event}.`);
                }
            }
            return next(effective);
        });
    }
}
//# sourceMappingURL=policy.js.map