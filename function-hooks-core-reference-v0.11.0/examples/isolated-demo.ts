import { fileURLToPath } from "node:url";
import { NodePermissionProcessLoader } from "@function-hooks/isolation";
import { FunctionHooksRuntime, registerCorePlugin } from "@function-hooks/compat";

const runtime = new FunctionHooksRuntime({
  budgets: {
    perEvent: {
      "prompt.submit": { deadlineMs: 5_000 },
      "ui.log": { deadlineMs: 5_000 },
    },
  },
});

const loader = new NodePermissionProcessLoader(runtime, {
  startupTimeoutMs: 5_000,
  invocationTimeoutMs: 5_000,
  maxOldSpaceMb: 96,
  capabilityGrants: { events: ["ui.log"] },
});

const modulePath = fileURLToPath(new URL("./plugins/isolated-policy.js", import.meta.url));
const plugin = await loader.load(modulePath, { pluginName: "isolated-example" });
await plugin.register(runtime.registrar("isolated-example", 10), { tag: "plugin" });

registerCorePlugin(runtime, 99, {
  promptSubmit: async (input) => input,
  uiLog: async ({ message }) => console.log(`[host-ui] ${message}`),
});

const $ = await runtime.start();
console.log(await $.prompt!.submit!({ text: "hello from the host" }));
await loader.close();
