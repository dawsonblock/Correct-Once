const trampoline = "data:text/javascript,import%20'node:fs'";
await import(trampoline);

export function register(on: any): void {
  on("prompt.submit", async (_$: any, event: any, next: any) => next(event));
}
