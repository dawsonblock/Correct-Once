import { FunctionHooksRuntime, registerCorePlugin } from "@function-hooks/compat";
const runtime = new FunctionHooksRuntime();
registerCorePlugin(runtime, 100, {
    promptSubmit: async ({ text }) => ({ normalized: text.trim().toUpperCase() }),
});
await runtime.start();
const result = await runtime.dispatch("prompt.submit", { text: " legacy package " });
if (JSON.stringify(result) !== JSON.stringify({ normalized: "LEGACY PACKAGE" })) {
    throw new Error(`unexpected compatibility result: ${JSON.stringify(result)}`);
}
console.log("compat package demo: PASS");
//# sourceMappingURL=compat-package-demo.js.map