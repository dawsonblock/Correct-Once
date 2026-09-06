import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const dir = resolve(process.cwd(), "dist", "tests");
const files = readdirSync(dir).filter((name) => name.endsWith(".test.js")).sort();
let total = 0;
for (const name of files) {
  const file = resolve(dir, name);
  const result = spawnSync(process.execPath, ["--test", file], { stdio: "inherit", timeout: 120_000 });
  if (result.error) {
    console.error(`top-level test file ${name} failed to execute: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
  total += 1;
}
console.log(`top-level test files: PASS (${total} files)`);
