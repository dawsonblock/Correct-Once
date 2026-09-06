export async function register(on: any, options?: any): Promise<void> {
  on("prompt.submit", async ($: any, event: any, next: any) => {
    await $.ui.log({ message: `${options?.tag ?? "isolated"}: ${event.text}` });
    return next({ ...event, text: `[isolated] ${event.text}` });
  });
}
