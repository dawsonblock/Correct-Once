import { readFileSync } from "node:fs";

export function register(on: any): void {
  void readFileSync;
  on("prompt.submit", async (_$: any, event: any, next: any) => next(event));
}
