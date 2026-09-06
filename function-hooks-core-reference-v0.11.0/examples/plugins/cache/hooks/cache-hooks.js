export function register(on) {
  on("tool.call", { tool: "CacheEvict" }, async ($, e, next) => {
    await $.ui.log({ message: `cache evict requested: ${String(e.args?.key ?? "")}` });
    return next(e);
  });
}
