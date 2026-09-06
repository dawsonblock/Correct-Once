import { readFile, access } from "node:fs/promises";
import { resolve } from "node:path";

const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const rootSource = stripComments(await readFile(resolve("src/index.ts"), "utf8"));
const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));
const failures = [];
const forbidden = [
  "FunctionHooksRuntime", "registerCorePlugin", "OnRegistrar", "HookRegistration",
  "addEvents", "engine.create", "@function-hooks/compat",
];
for (const token of forbidden) {
  if (rootSource.includes(token)) failures.push(`root src/index.ts leaks compatibility token: ${token}`);
}
if (!packageJson.exports?.["./compat"]) failures.push("explicit ./compat migration subpath is missing");
for (const key of Object.keys(packageJson.exports ?? {})) {
  if (key.includes("runtime/")) failures.push(`legacy runtime subpath is exported: ${key}`);
}
for (const path of ["src/runtime/runtime.ts", "src/runtime/types.ts", "src/core.ts"]) {
  try { await access(resolve(path)); failures.push(`legacy umbrella shim still exists: ${path}`); } catch {}
}
const declaration = stripComments(await readFile(resolve("dist/src/index.d.ts"), "utf8"));
for (const token of ["FunctionHooksRuntime", "registerCorePlugin", "@function-hooks/compat"]) {
  if (declaration.includes(token)) failures.push(`published root declaration leaks compatibility token: ${token}`);
}
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log("umbrella stable surface: PASS (compatibility is explicit-subpath only)");
