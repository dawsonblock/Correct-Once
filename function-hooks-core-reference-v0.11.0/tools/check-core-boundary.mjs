import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve("packages/core/src");
const forbidden = ["assurance", "audit", "replay", "plugin", "plugins", "isolation", "enterprise", "events"];
const allowedNode = new Set(["node:async_hooks"]);

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(path));
    else if (entry.name.endsWith(".ts")) out.push(path);
  }
  return out;
}

const failures = [];
for (const file of await walk(root)) {
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
    const specifier = match[1];
    if (specifier.startsWith("node:") && !allowedNode.has(specifier)) {
      failures.push(`${file}: unexpected Node dependency ${specifier}`);
    }
    if (specifier.startsWith("@function-hooks/")) {
      failures.push(`${file}: core must not import sibling package ${specifier}`);
    }
    if (forbidden.some((name) => specifier.includes(`/${name}/`) || specifier.endsWith(`/${name}`))) {
      failures.push(`${file}: forbidden higher-layer dependency ${specifier}`);
    }
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("core-boundary: PASS — no higher-layer package imports detected");
}
