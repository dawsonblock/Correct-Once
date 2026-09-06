import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(process.cwd(), "packages");
const allowed = {
  core: new Set(),
  events: new Set(["core"]),
  portable: new Set(["core"]),
  assurance: new Set(["core"]),
  audit: new Set(["core","assurance"]),
  replay: new Set(["core","assurance"]),
  plugins: new Set(["core","assurance"]),
  isolation: new Set(["core","plugins"]),
  enterprise: new Set(["core","assurance","audit"]),
  compat: new Set(["assurance"]),
  gateway: new Set(["core","assurance","audit"]),
  capabilities: new Set(),
  router: new Set(["gateway","capabilities"]),
};
let failures = [];
for (const [name, deps] of Object.entries(allowed)) {
  const pkg = JSON.parse(await readFile(resolve(root,name,"package.json"),"utf8"));
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    if (!dep.startsWith("@function-hooks/")) continue;
    const target=dep.slice("@function-hooks/".length);
    if (!deps.has(target)) failures.push(`${name} package.json illegally depends on ${target}`);
  }
  const files=[];
  async function walk(dir){ for(const e of await readdir(dir,{withFileTypes:true})){const p=resolve(dir,e.name); if(e.isDirectory()) await walk(p); else if(e.name.endsWith(".ts")) files.push(p);} }
  await walk(resolve(root,name,"src"));
  for (const file of files) {
    const text=await readFile(file,"utf8");
    for (const m of text.matchAll(/from\s+["']@function-hooks\/([^"']+)["']/g)) {
      const target=m[1]; if(target!==name && !deps.has(target)) failures.push(`${name} source ${file} illegally imports ${target}`);
    }
    if (/from\s+["'](?:\.\.\/){2,}/.test(text)) failures.push(`${name} source ${file} reaches across package directories`);
  }
}
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log("package dependency DAG: PASS");
