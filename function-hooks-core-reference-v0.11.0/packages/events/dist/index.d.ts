import { type Engine, type EngineBlueprint, type KernelBuilder, type KernelOptions } from "@function-hooks/core";
export interface ToolCallInput {
    readonly tool: string;
    readonly command?: string;
    readonly args?: unknown;
    readonly timeout?: number;
}
export type StandardEvents = {
    "plugin.register": {
        input: {
            readonly name?: string;
        };
        result: unknown;
    };
    "tool.call": {
        input: ToolCallInput;
        result: unknown;
    };
    "prompt.submit": {
        input: {
            readonly text: string;
        };
        result: unknown;
    };
    "fs.read": {
        input: {
            readonly path: string;
        };
        result: unknown;
    };
    "fs.write": {
        input: {
            readonly path: string;
            readonly data: string;
        };
        result: unknown;
    };
    "network.fetch": {
        input: {
            readonly url: string;
            readonly init?: unknown;
        };
        result: unknown;
    };
    "model.call": {
        input: {
            readonly model: string;
            readonly messages: readonly unknown[];
        };
        result: unknown;
    };
    "terminal.exec": {
        input: {
            readonly command: string;
            readonly timeout?: number;
        };
        result: unknown;
    };
    "permissions.check": {
        input: {
            readonly capability: string;
            readonly resource?: string;
        };
        result: unknown;
    };
    "ui.render": {
        input: {
            readonly component: string;
            readonly props: unknown;
            readonly surface: string;
        };
        result: unknown;
    };
    "ui.resolve": {
        input: {
            readonly surface: string;
        };
        result: unknown;
    };
    "ui.log": {
        input: {
            readonly message: string;
        };
        result: void;
    };
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
export declare function createStandardEventBlueprint(adapters?: StandardAdapters): EngineBlueprint<StandardEvents>;
/**
 * Convenience migration path for the standard catalog. Hooks may be registered
 * on the returned builder before build(); no legacy engine.create fold is used.
 */
export declare function createStandardKernel(adapters?: StandardAdapters, options?: KernelOptions<StandardEvents>): KernelBuilder<StandardEvents>;
//# sourceMappingURL=index.d.ts.map