export async function register(on: any, options?: any): Promise<void> {
  on("prompt.submit", async ($: any, event: any, next: any) => {
    await $.ui.log({ message: `${options?.prefix ?? "isolated"}:${event.text}` });
    return next({ ...event, text: String(event.text).toUpperCase() });
  });
}
