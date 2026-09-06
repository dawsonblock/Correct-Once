import { createBlueprint, createKernel, type Engine, type EngineBlueprint, type KernelBuilder, type KernelOptions } from "@function-hooks/core";

export interface ToolCallInput {
  readonly tool: string;
  readonly command?: string;
  readonly args?: unknown;
  readonly timeout?: number;
}

export type StandardEvents = {
  "plugin.register": { input: { readonly name?: string }; result: unknown };
  "tool.call": { input: ToolCallInput; result: unknown };
  "prompt.submit": { input: { readonly text: string }; result: unknown };
  "fs.read": { input: { readonly path: string }; result: unknown };
  "fs.write": { input: { readonly path: string; readonly data: string }; result: unknown };
  "network.fetch": { input: { readonly url: string; readonly init?: unknown }; result: unknown };
  "model.call": { input: { readonly model: string; readonly messages: readonly unknown[] }; result: unknown };
  "terminal.exec": { input: { readonly command: string; readonly timeout?: number }; result: unknown };
  "permissions.check": { input: { readonly capability: string; readonly resource?: string }; result: unknown };
  "ui.render": { input: { readonly component: string; readonly props: unknown; readonly surface: string }; result: unknown };
  "ui.resolve": { input: { readonly surface: string }; result: unknown };
  "ui.log": { input: { readonly message: string }; result: void };
};

export interface StandardAdapters {
  readonly pluginRegister?: (input: StandardEvents["plugin.register"]["input"], engine: Engine<StandardEvents>) => unknown | Promise<unknown>;
  readonly toolCall?: (input: ToolCallInput, engine: Engine<StandardEvents>) => unknown | Promise<unknown>;
  readonly promptSubmit?: (input: StandardEvents["prompt.submit"]["input"], engine: Engine<StandardEvents>) => unknown | Promise<unknown>;
  readonly fsRead?: (input: StandardEvents["fs.read"]["input"], engine: Engine<StandardEvents>) => unknown | Promise<unknown>;
  readonly fsWrite?: (input: StandardEvents["fs.write"]["input"], engine: Engine<StandardEvents>) => unknown | Promise<unknown>;
  readonly networkFetch?: (input: StandardEvents["network.fetch"]["input"], engine: Engine<StandardEvents>) => unknown | Promise<unknown>;
  readonly modelCall?: (input: StandardEvents["model.call"]["input"], engine: Engine<StandardEvents>) => unknown | Promise<unknown>;
  readonly terminalExec?: (input: StandardEvents["terminal.exec"]["input"], engine: Engine<StandardEvents>) => unknown | Promise<unknown>;
  readonly permissionsCheck?: (input: StandardEvents["permissions.check"]["input"], engine: Engine<StandardEvents>) => unknown | Promise<unknown>;
  readonly uiRender?: (input: StandardEvents["ui.render"]["input"], engine: Engine<StandardEvents>) => unknown | Promise<unknown>;
  readonly uiResolve?: (input: StandardEvents["ui.resolve"]["input"], engine: Engine<StandardEvents>) => unknown | Promise<unknown>;
  readonly uiLog?: (input: StandardEvents["ui.log"]["input"], engine: Engine<StandardEvents>) => void | Promise<void>;
}

function unavailable(name: string): never {
  throw new Error(`Standard event ${name} has no host adapter.`);
}

export function createStandardEventBlueprint(adapters: StandardAdapters = {}): EngineBlueprint<StandardEvents> {
  return createBlueprint<StandardEvents>({
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
export function createStandardKernel(
  adapters: StandardAdapters = {},
  options: KernelOptions<StandardEvents> = {},
): KernelBuilder<StandardEvents> {
  const builder = createKernel<StandardEvents>(options);
  builder.defineEngine(createStandardEventBlueprint(adapters));
  return builder;
}
