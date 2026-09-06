export async function register(on, options) {
    on("prompt.submit", async ($, event, next) => {
        await $.ui.log({ message: `${options?.prefix ?? "isolated"}:${event.text}` });
        return next({ ...event, text: String(event.text).toUpperCase() });
    });
}
//# sourceMappingURL=isolated-plugin.js.map