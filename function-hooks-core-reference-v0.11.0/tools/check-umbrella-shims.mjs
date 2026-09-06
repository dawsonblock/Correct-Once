import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const shims = [
  "src/runtime/types.ts",
  "src/runtime/errors.ts",
  "src/runtime/freeze.ts",
  "src/runtime/matcher.ts",
  "src/runtime/blueprint.ts",
  "src/runtime/runtime.ts",
  "src/core.ts",
];
const failures = [];
for (const file of shims) {
  const source = await readFile(resolve(file), "utf8");
  if (!source.includes("@function-hooks/compat")) failures.push(`${file}: does not delegate to @function-hooks/compat`);
  if (/\bclass\s+FunctionHooksRuntime\b|\bfunction\s+registerCorePlugin\s*\(/.test(source)) {
    failures.push(`${file}: contains legacy implementation instead of a shim`);
  }
  if (source.split("\n").length > 8) failures.push(`${file}: compatibility shim unexpectedly exceeds 8 lines`);
}
if (failures.length) {
  console.error(failures.join("\n")); process.exit(1);
}
console.log("umbrella legacy-runtime shims: PASS");
