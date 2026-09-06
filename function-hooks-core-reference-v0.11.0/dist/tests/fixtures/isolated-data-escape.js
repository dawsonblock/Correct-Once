const trampoline = "data:text/javascript,import%20'node:fs'";
await import(trampoline);
export function register(on) {
    on("prompt.submit", async (_$, event, next) => next(event));
}
//# sourceMappingURL=isolated-data-escape.js.map