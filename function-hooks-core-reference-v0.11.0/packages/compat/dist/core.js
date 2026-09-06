import { addEvents } from "./runtime/blueprint.js";
import { schema } from "@function-hooks/assurance";
const unknownResult = schema.unknown("host-adapter-result");
const toolInput = schema.object({
    tool: schema.string(),
    command: schema.optional(schema.string()),
    args: schema.optional(schema.unknown()),
    timeout: schema.optional(schema.number()),
}, { allowUnknown: false }, "tool.call.input");
function unavailable(name) {
    throw new Error(`Core capability ${name} has no host adapter. The reference runtime fails closed.`);
}
/** @deprecated Standard events moved to @function-hooks/events. */
export function registerCorePlugin(runtime, pluginOrder, adapters = {}) {
    const on = runtime.registrar("core", pluginOrder);
    on("engine.create", async (_$, event, next) => {
        const below = await next(event);
        return addEvents(below, "core", {
            "plugin.register": {
                schemaVersion: "1.0.0",
                inputSchema: schema.object({ name: schema.optional(schema.string()) }, { allowUnknown: true }, "plugin.register.input"),
                resultSchema: unknownResult,
                behavior: { sideEffect: true, idempotent: false, maxNextCalls: 1, sensitivity: "internal" },
                invoke: async (input) => ({ allow: true, input }),
            },
            "tool.call": {
                schemaVersion: "1.0.0",
                inputSchema: toolInput,
                resultSchema: unknownResult,
                behavior: { sideEffect: true, idempotent: false, maxNextCalls: 1, sensitivity: "internal" },
                invoke: (input, engine) => adapters.toolCall?.(input, engine) ?? unavailable("tool.call"),
            },
            "prompt.submit": {
                schemaVersion: "1.0.0",
                inputSchema: schema.object({ text: schema.string() }, { allowUnknown: false }, "prompt.submit.input"),
                resultSchema: unknownResult,
                behavior: { sideEffect: false, idempotent: false, sensitivity: "internal" },
                invoke: (input, engine) => adapters.promptSubmit?.(input, engine) ?? unavailable("prompt.submit"),
            },
            "fs.read": {
                schemaVersion: "1.0.0",
                inputSchema: schema.object({ path: schema.string() }, { allowUnknown: false }, "fs.read.input"),
                resultSchema: unknownResult,
                behavior: { sideEffect: false, idempotent: true, sensitivity: "secret" },
                invoke: (input, engine) => adapters.fsRead?.(input, engine) ?? unavailable("fs.read"),
            },
            "fs.write": {
                schemaVersion: "1.0.0",
                inputSchema: schema.object({ path: schema.string(), data: schema.string() }, { allowUnknown: false }, "fs.write.input"),
                resultSchema: unknownResult,
                behavior: { sideEffect: true, idempotent: false, maxNextCalls: 1, sensitivity: "secret" },
                invoke: (input, engine) => adapters.fsWrite?.(input, engine) ?? unavailable("fs.write"),
            },
            "network.fetch": {
                schemaVersion: "1.0.0",
                inputSchema: schema.object({ url: schema.string(), init: schema.optional(schema.unknown()) }, { allowUnknown: false }, "network.fetch.input"),
                resultSchema: unknownResult,
                behavior: { sideEffect: true, idempotent: false, maxNextCalls: 1, sensitivity: "internal" },
                invoke: (input, engine) => adapters.networkFetch?.(input, engine) ?? unavailable("network.fetch"),
            },
            "model.call": {
                schemaVersion: "1.0.0",
                inputSchema: schema.object({ model: schema.string(), messages: schema.array(schema.unknown()) }, { allowUnknown: false }, "model.call.input"),
                resultSchema: unknownResult,
                behavior: { sideEffect: true, idempotent: false, maxNextCalls: 1, sensitivity: "secret" },
                invoke: (input, engine) => adapters.modelCall?.(input, engine) ?? unavailable("model.call"),
            },
            "terminal.exec": {
                schemaVersion: "1.0.0",
                inputSchema: schema.object({ command: schema.string(), timeout: schema.optional(schema.number()) }, { allowUnknown: false }, "terminal.exec.input"),
                resultSchema: unknownResult,
                behavior: { sideEffect: true, idempotent: false, maxNextCalls: 1, sensitivity: "secret" },
                invoke: (input, engine) => adapters.terminalExec?.(input, engine) ?? unavailable("terminal.exec"),
            },
            "permissions.check": {
                schemaVersion: "1.0.0",
                inputSchema: schema.object({ capability: schema.string(), resource: schema.optional(schema.string()) }, { allowUnknown: false }, "permissions.check.input"),
                resultSchema: unknownResult,
                behavior: { sideEffect: false, idempotent: true, sensitivity: "internal" },
                invoke: (input, engine) => adapters.permissionsCheck?.(input, engine) ?? unavailable("permissions.check"),
            },
            "ui.render": {
                schemaVersion: "1.0.0",
                inputSchema: schema.object({ component: schema.string(), props: schema.unknown(), surface: schema.string() }, { allowUnknown: false }, "ui.render.input"),
                resultSchema: unknownResult,
                behavior: { sideEffect: false, idempotent: false, sensitivity: "internal" },
                invoke: (input, engine) => adapters.uiRender?.(input, engine) ?? input,
            },
            "ui.resolve": {
                schemaVersion: "1.0.0",
                inputSchema: schema.object({ surface: schema.string() }, { allowUnknown: false }, "ui.resolve.input"),
                resultSchema: unknownResult,
                behavior: { sideEffect: false, idempotent: true, sensitivity: "public" },
                invoke: (input, engine) => adapters.uiResolve?.(input, engine) ?? ({ surface: input.surface, elements: {} }),
            },
            "ui.log": {
                schemaVersion: "1.0.0",
                inputSchema: schema.object({ message: schema.string() }, { allowUnknown: false }, "ui.log.input"),
                resultSchema: unknownResult,
                behavior: { sideEffect: true, idempotent: false, maxNextCalls: 1, sensitivity: "internal" },
                invoke: (input, engine) => adapters.uiLog?.(input, engine) ?? undefined,
            },
        });
    });
}
//# sourceMappingURL=core.js.map