import { createBlueprint, createKernel } from "@function-hooks/core";
function unavailable(name) {
    throw new Error(`Standard event ${name} has no host adapter.`);
}
export function createStandardEventBlueprint(adapters = {}) {
    return createBlueprint({
        "plugin.register": { invoke: (input, engine) => adapters.pluginRegister ? adapters.pluginRegister(input, engine) : ({ allow: true, input }) },
        "tool.call": { invoke: (input, engine) => adapters.toolCall ? adapters.toolCall(input, engine) : unavailable("tool.call") },
        "prompt.submit": { invoke: (input, engine) => adapters.promptSubmit ? adapters.promptSubmit(input, engine) : unavailable("prompt.submit") },
        "fs.read": { invoke: (input, engine) => adapters.fsRead ? adapters.fsRead(input, engine) : unavailable("fs.read") },
        "fs.write": { invoke: (input, engine) => adapters.fsWrite ? adapters.fsWrite(input, engine) : unavailable("fs.write") },
        "network.fetch": { invoke: (input, engine) => adapters.networkFetch ? adapters.networkFetch(input, engine) : unavailable("network.fetch") },
        "model.call": { invoke: (input, engine) => adapters.modelCall ? adapters.modelCall(input, engine) : unavailable("model.call") },
        "terminal.exec": { invoke: (input, engine) => adapters.terminalExec ? adapters.terminalExec(input, engine) : unavailable("terminal.exec") },
        "permissions.check": { invoke: (input, engine) => adapters.permissionsCheck ? adapters.permissionsCheck(input, engine) : unavailable("permissions.check") },
        "ui.render": { invoke: (input, engine) => adapters.uiRender ? adapters.uiRender(input, engine) : input },
        "ui.resolve": { invoke: (input, engine) => adapters.uiResolve ? adapters.uiResolve(input, engine) : ({ surface: input.surface, elements: {} }) },
        "ui.log": { invoke: async (input, engine) => { await adapters.uiLog?.(input, engine); } },
    });
}
/**
 * Convenience migration path for the standard catalog. Hooks may be registered
 * on the returned builder before build(); no legacy engine.create fold is used.
 */
export function createStandardKernel(adapters = {}, options = {}) {
    const builder = createKernel(options);
    builder.defineEngine(createStandardEventBlueprint(adapters));
    return builder;
}
//# sourceMappingURL=index.js.map