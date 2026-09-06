export async function register(on, options) {
    on("prompt.submit", async ($, event, next) => {
        await $.ui.log({ message: `${options?.tag ?? "isolated"}: ${event.text}` });
        return next({ ...event, text: `[isolated] ${event.text}` });
    });
}
//# sourceMappingURL=isolated-policy.js.map