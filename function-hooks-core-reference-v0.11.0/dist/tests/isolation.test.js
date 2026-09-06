import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { FunctionHooksRuntime, registerCorePlugin } from "@function-hooks/compat";
import { NodePermissionProcessLoader } from "@function-hooks/isolation";
test("isolated process hook can call $ and next while host binds origin", async () => {
    const runtime = new FunctionHooksRuntime({ budgets: { perEvent: { "prompt.submit": { deadlineMs: 3_000 }, "ui.log": { deadlineMs: 3_000 } } } });
    let logMessage = "";
    let seenOrigin = "";
    const observe = runtime.registrar("observer", 0);
    observe("ui.log", async (_$, event, next) => {
        seenOrigin = next.origin;
        return next(event);
    });
    const loader = new NodePermissionProcessLoader(runtime, { startupTimeoutMs: 5_000, invocationTimeoutMs: 3_000, capabilityGrants: { events: ["ui.log"] } });
    const modulePath = fileURLToPath(new URL("./fixtures/isolated-plugin.js", import.meta.url));
    const module = await loader.load(modulePath, { pluginName: "isolated-demo" });
    await module.register(runtime.registrar("isolated-demo", 10), { prefix: "iso" });
    registerCorePlugin(runtime, 99, {
        promptSubmit: async (input) => input,
        uiLog: async ({ message }) => { logMessage = message; },
    });
    const $ = await runtime.start();
    const result = await $.prompt.submit({ text: "hello" });
    assert.equal(result.text, "HELLO");
    assert.equal(logMessage, "iso:hello");
    assert.equal(seenOrigin, "isolated-demo");
    await loader.close();
});
test("isolated loader denies plugin imports of ambient Node builtins", async () => {
    const runtime = new FunctionHooksRuntime();
    const loader = new NodePermissionProcessLoader(runtime, { startupTimeoutMs: 3_000 });
    const modulePath = fileURLToPath(new URL("./fixtures/isolated-bad.js", import.meta.url));
    const module = await loader.load(modulePath, { pluginName: "bad" });
    await assert.rejects(() => module.register(runtime.registrar("bad", 1)));
    await loader.close();
});
test("isolated loader denies data-URL trampoline imports", async () => {
    const runtime = new FunctionHooksRuntime();
    const loader = new NodePermissionProcessLoader(runtime, { startupTimeoutMs: 3_000 });
    const modulePath = fileURLToPath(new URL("./fixtures/isolated-data-escape.js", import.meta.url));
    const module = await loader.load(modulePath, { pluginName: "data-escape" });
    await assert.rejects(() => module.register(runtime.registrar("data-escape", 1)));
    await loader.close();
});
//# sourceMappingURL=isolation.test.js.map