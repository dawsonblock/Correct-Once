import { lstat, mkdir, realpath, symlink } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

const root = process.cwd();
const scope = resolve(root, "node_modules", "@function-hooks");
const packages = ["core", "events", "assurance", "audit", "replay", "plugins", "isolation", "enterprise", "compat", "portable", "gateway", "capabilities", "router"];
await mkdir(scope, { recursive: true });

for (const name of packages) {
  const target = resolve(root, "packages", name);
  const link = resolve(scope, name);
  try {
    await lstat(link);
    const [actual, expected] = await Promise.all([realpath(link), realpath(target)]);
    if (actual !== expected) throw new Error(`${link} already exists but resolves to ${actual}, expected ${expected}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const rel = relative(dirname(link), target);
    await symlink(rel, link, process.platform === "win32" ? "junction" : "dir");
  }
}
console.log("workspace links: PASS");
