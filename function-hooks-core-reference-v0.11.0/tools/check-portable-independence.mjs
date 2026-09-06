import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve("packages/portable/src");
const failures = [];
async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(path));
    else if (entry.name.endsWith(".ts")) out.push(path);
  }
  return out;
}
for (const file of await walk(root)) {
  const source = await readFile(file, "utf8");
  if (/from\s+["']node:async_hooks["']/.test(source)) failures.push(`${file}: portable runtime must not use AsyncLocalStorage`);
  for (const match of source.matchAll(/import\s+(?!type\b)[\s\S]*?from\s+["']@function-hooks\/core(?:\/[^"']*)?["']/g)) {
    failures.push(`${file}: value-imports reference implementation code from ${match[0].replace(/\s+/g," ")}`);
  }
  for (const name of ["createKernel", "immutableEvent", "substructuralMatch", "snapshotBlueprint", "FunctionHooksError"]) {
    if (new RegExp(`\\b${name}\\b`).test(source) && !source.includes(`function ${name}`) && !source.includes(`class ${name}`)) {
      failures.push(`${file}: suspicious reference-runtime symbol ${name}`);
    }
  }
}
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log("portable-runtime independence: PASS — type contracts only; no reference runtime or AsyncLocalStorage imports");
