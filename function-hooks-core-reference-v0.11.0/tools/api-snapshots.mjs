import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

const mode = process.argv[2] ?? "check";
if (!new Set(["check", "update"]).has(mode)) throw new Error("usage: node tools/api-snapshots.mjs [check|update]");
const root = process.cwd();
const packageRoots = [root, ...["core","portable","events","assurance","audit","replay","plugins","isolation","enterprise","compat","gateway","capabilities","router"].map((n)=>resolve(root,"packages",n))];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function exportedTypeEntrypoints(pkg) {
  const out = [];
  if (typeof pkg.types === "string") out.push(pkg.types);
  for (const value of Object.values(pkg.exports ?? {})) {
    if (typeof value === "object" && value && typeof value.types === "string") out.push(value.types);
  }
  return [...new Set(out)];
}

async function declarationClosure(packageRoot, entrypoints) {
  const seen = new Set();
  async function visit(file) {
    const abs = resolve(packageRoot, file);
    if (seen.has(abs)) return;
    let text;
    try { text = await readFile(abs, "utf8"); } catch (error) { throw new Error(`missing declaration ${relative(root, abs)}: ${error.message}`); }
    seen.add(abs);
    const regex = /(?:from\s+|import\s*\(\s*)["'](\.[^"']+)["']/g;
    for (const match of text.matchAll(regex)) {
      let spec = match[1];
      if (spec.endsWith(".js")) spec = spec.slice(0, -3) + ".d.ts";
      else if (!spec.endsWith(".d.ts")) spec += ".d.ts";
      await visit(relative(packageRoot, resolve(dirname(abs), spec)));
    }
  }
  for (const entry of entrypoints) await visit(entry);
  const files = [...seen].sort();
  const records = [];
  for (const abs of files) {
    const raw = (await readFile(abs, "utf8")).replace(/\r\n/g, "\n");
    const text = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").split("\n").map((line) => line.trimEnd()).filter((line) => line.trim().length > 0).join("\n") + "\n";
    records.push({ path: relative(packageRoot, abs).split(sep).join("/"), sha256: sha256(text) });
  }
  return records;
}

const snapshots = [];
for (const packageRoot of packageRoots) {
  const pkg = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
  const entrypoints = exportedTypeEntrypoints(pkg);
  const files = await declarationClosure(packageRoot, entrypoints);
  const aggregateSha256 = sha256(JSON.stringify(files));
  snapshots.push({ package: pkg.name, exportedTypeEntrypoints: entrypoints.sort(), aggregateSha256, files });
}
await mkdir(resolve(root, "api-snapshots"), { recursive: true });
let failures = 0;
for (const snapshot of snapshots) {
  const slug = snapshot.package.replace(/^@/, "").replaceAll("/", "-");
  const path = resolve(root, "api-snapshots", `${slug}.json`);
  if (mode === "update") {
    await writeFile(path, JSON.stringify(snapshot, null, 2) + "\n");
  } else {
    let expected;
    try { expected = JSON.parse(await readFile(path, "utf8")); }
    catch { console.error(`${snapshot.package}: API snapshot missing`); failures += 1; continue; }
    if (JSON.stringify(expected) !== JSON.stringify(snapshot)) {
      console.error(`${snapshot.package}: public declaration snapshot drift (${expected.aggregateSha256 ?? "unknown"} -> ${snapshot.aggregateSha256})`);
      failures += 1;
    }
  }
}
if (failures) process.exit(1);
console.log(`API declaration snapshots: ${mode === "update" ? "UPDATED" : "PASS"} (${snapshots.length} packages)`);
