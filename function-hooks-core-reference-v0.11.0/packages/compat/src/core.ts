import { addEvents } from "./runtime/blueprint.js";
import { schema } from "@function-hooks/assurance";
import type { EngineObject } from "./runtime/types.js";
import type { FunctionHooksRuntime } from "./runtime/runtime.js";

export interface ToolCallInput {
  readonly tool: string;
  readonly command?: string;
  readonly args?: unknown;
  readonly timeout?: number;
}

export type ToolCallResult = { readonly ok: true; readonly value: unknown } | { readonly deny: string };

export interface CoreAdapters {
  readonly toolCall?: (input: ToolCallInput, engine: EngineObject) => unknown | Promise<unknown>;
  readonly promptSubmit?: (input: { readonly text: string }, engine: EngineObject) => unknown | Promise<unknown>;
  readonly fsRead?: (input: { readonly path: string }, engine: EngineObject) => unknown | Promise<unknown>;
  readonly fsWrite?: (input: { readonly path: string; readonly data: string }, engine: EngineObject) => unknown | Promise<unknown>;
  readonly networkFetch?: (input: { readonly url: string; readonly init?: unknown }, engine: EngineObject) => unknown | Promise<unknown>;
  readonly modelCall?: (input: { readonly model: string; readonly messages: readonly unknown[] }, engine: EngineObject) => unknown | Promise<unknown>;
  readonly terminalExec?: (input: { readonly command: string; readonly timeout?: number }, engine: EngineObject) => unknown | Promise<unknown>;
  readonly permissionsCheck?: (input: { readonly capability: string; readonly resource?: string }, engine: EngineObject) => unknown | Promise<unknown>;
  readonly uiRender?: (input: { readonly component: string; readonly props: unknown; readonly surface: string }, engine: EngineObject) => unknown | Promise<unknown>;
  readonly uiResolve?: (input: { readonly surface: string }, engine: EngineObject) => unknown | Promise<unknown>;
  readonly uiLog?: (input: { readonly message: string }, engine: EngineObject) => unknown | Promise<unknown>;
}

const unknownResult = schema.unknown("host-adapter-result");
const toolInput = schema.object({
  tool: schema.string(),
  command: schema.optional(schema.string()),
  args: schema.optional(schema.unknown()),
  timeout: schema.optional(schema.number()),
}, { allowUnknown: false }, "tool.call.input");

function unavailable(name: string): never {
  throw new Error(`Core capability ${name} has no host adapter. The reference runtime fails closed.`);
}

/** @deprecated Standard events moved to @function-hooks/events. */
export function registerCorePlugin(runtime: FunctionHooksRuntime, pluginOrder: number, adapters: CoreAdapters = {}): void {
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
        invoke: (input, engine) => adapters.toolCall?.(input as unknown as ToolCallInput, engine) ?? unavailable("tool.call"),
      },
      "prompt.submit": {
        schemaVersion: "1.0.0",
        inputSchema: schema.object({ text: schema.string() }, { allowUnknown: false }, "prompt.submit.input"),
        resultSchema: unknownResult,
        behavior: { sideEffect: false, idempotent: false, sensitivity: "internal" },
        invoke: (input, engine) => adapters.promptSubmit?.(input as { text: string }, engine) ?? unavailable("prompt.submit"),
      },
      "fs.read": {
        schemaVersion: "1.0.0",
        inputSchema: schema.object({ path: schema.string() }, { allowUnknown: false }, "fs.read.input"),
        resultSchema: unknownResult,
        behavior: { sideEffect: false, idempotent: true, sensitivity: "secret" },
        invoke: (input, engine) => adapters.fsRead?.(input as { path: string }, engine) ?? unavailable("fs.read"),
      },
      "fs.write": {
        schemaVersion: "1.0.0",
        inputSchema: schema.object({ path: schema.string(), data: schema.string() }, { allowUnknown: false }, "fs.write.input"),
        resultSchema: unknownResult,
        behavior: { sideEffect: true, idempotent: false, maxNextCalls: 1, sensitivity: "secret" },
        invoke: (input, engine) => adapters.fsWrite?.(input as { path: string; data: string }, engine) ?? unavailable("fs.write"),
      },
      "network.fetch": {
        schemaVersion: "1.0.0",
        inputSchema: schema.object({ url: schema.string(), init: schema.optional(schema.unknown()) }, { allowUnknown: false }, "network.fetch.input"),
        resultSchema: unknownResult,
        behavior: { sideEffect: true, idempotent: false, maxNextCalls: 1, sensitivity: "internal" },
        invoke: (input, engine) => adapters.networkFetch?.(input as { url: string; init?: unknown }, engine) ?? unavailable("network.fetch"),
      },
      "model.call": {
        schemaVersion: "1.0.0",
        inputSchema: schema.object({ model: schema.string(), messages: schema.array(schema.unknown()) }, { allowUnknown: false }, "model.call.input"),
        resultSchema: unknownResult,
        behavior: { sideEffect: true, idempotent: false, maxNextCalls: 1, sensitivity: "secret" },
        invoke: (input, engine) => adapters.modelCall?.(input as { model: string; messages: readonly unknown[] }, engine) ?? unavailable("model.call"),
      },
      "terminal.exec": {
        schemaVersion: "1.0.0",
        inputSchema: schema.object({ command: schema.string(), timeout: schema.optional(schema.number()) }, { allowUnknown: false }, "terminal.exec.input"),
        resultSchema: unknownResult,
        behavior: { sideEffect: true, idempotent: false, maxNextCalls: 1, sensitivity: "secret" },
        invoke: (input, engine) => adapters.terminalExec?.(input as { command: string; timeout?: number }, engine) ?? unavailable("terminal.exec"),
      },
      "permissions.check": {
        schemaVersion: "1.0.0",
        inputSchema: schema.object({ capability: schema.string(), resource: schema.optional(schema.string()) }, { allowUnknown: false }, "permissions.check.input"),
        resultSchema: unknownResult,
        behavior: { sideEffect: false, idempotent: true, sensitivity: "internal" },
        invoke: (input, engine) => adapters.permissionsCheck?.(input as { capability: string; resource?: string }, engine) ?? unavailable("permissions.check"),
      },
      "ui.render": {
        schemaVersion: "1.0.0",
        inputSchema: schema.object({ component: schema.string(), props: schema.unknown(), surface: schema.string() }, { allowUnknown: false }, "ui.render.input"),
        resultSchema: unknownResult,
        behavior: { sideEffect: false, idempotent: false, sensitivity: "internal" },
        invoke: (input, engine) => adapters.uiRender?.(input as { component: string; props: unknown; surface: string }, engine) ?? input,
      },
      "ui.resolve": {
        schemaVersion: "1.0.0",
        inputSchema: schema.object({ surface: schema.string() }, { allowUnknown: false }, "ui.resolve.input"),
        resultSchema: unknownResult,
        behavior: { sideEffect: false, idempotent: true, sensitivity: "public" },
        invoke: (input, engine) => adapters.uiResolve?.(input as { surface: string }, engine) ?? ({ surface: (input as { surface: string }).surface, elements: {} }),
      },
      "ui.log": {
        schemaVersion: "1.0.0",
        inputSchema: schema.object({ message: schema.string() }, { allowUnknown: false }, "ui.log.input"),
        resultSchema: unknownResult,
        behavior: { sideEffect: true, idempotent: false, maxNextCalls: 1, sensitivity: "internal" },
        invoke: (input, engine) => adapters.uiLog?.(input as { message: string }, engine) ?? undefined,
      },
    });
  });
}
