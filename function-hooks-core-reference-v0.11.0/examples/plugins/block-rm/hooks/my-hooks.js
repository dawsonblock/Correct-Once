export function register(on) {
  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    if (e.command === "rm -rf /") return { deny: "Destructive command blocked by hook" };
    return next(e);
  });
}
