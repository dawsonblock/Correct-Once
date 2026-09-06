import { createStandardKernel } from "../src/index.js";

const builder = createStandardKernel({
  toolCall: async (input) => ({ ok: true, value: `executed ${input.tool}: ${input.command ?? ""}` }),
  uiLog: async ({ message }) => console.log(message),
});

builder.on("security", 0, "tool.call", { tool: "Bash" }, async (_engine, event, next) => {
  if (event.command === "rm -rf /") return { deny: "Destructive command blocked by hook" };
  return next(event);
});

builder.on("observability", 10, "tool.call", async (_engine, event, next) => {
  const result = await next(event);
  console.log(`[audit] ${next.origin} -> ${next.event}`);
  return result;
});

const runtime = builder.build();
await runtime.start();
console.log(await runtime.dispatch("tool.call", { tool: "Bash", command: "echo hello" }, { origin: "demo" }));
console.log(await runtime.dispatch("tool.call", { tool: "Bash", command: "rm -rf /" }, { origin: "demo" }));
await runtime.close();
