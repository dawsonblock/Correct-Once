import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const mode = process.argv[2] ?? "check";
if (!new Set(["check", "update"]).has(mode)) throw new Error("usage: node tools/semantics-freeze.mjs [check|update]");
const root = process.cwd();
const conformance = await import(`${pathToFileURL(resolve(root, "packages/core/dist/conformance.js")).href}?freeze=${Date.now()}`);
const semanticsPath = resolve(root, "packages/core/SEMANTICS.md");
const semanticsText = await readFile(semanticsPath, "utf8");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonical = {
  semanticsVersion: conformance.KERNEL_SEMANTICS_VERSION,
  caseNames: [...conformance.KERNEL_CONFORMANCE_CASE_NAMES],
  goldenTrace: conformance.THREE_HOOK_GOLDEN_TRACE,
  semanticsMdSha256: sha256(semanticsText),
};
const contractSha256 = sha256(JSON.stringify(canonical));
const snapshot = { ...canonical, contractSha256 };
const path = resolve(root, `contracts/kernel-semantics-${canonical.semanticsVersion}.json`);
if (mode === "update") {
  await mkdir(resolve(root, "contracts"), { recursive: true });
  await writeFile(path, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(`semantics freeze updated: ${canonical.semanticsVersion} ${contractSha256}`);
} else {
  const expected = JSON.parse(await readFile(path, "utf8"));
  if (JSON.stringify(expected) !== JSON.stringify(snapshot)) {
    console.error("semantic contract drift detected. Changing a frozen RC requires a new semantics version and a new snapshot.");
    console.error(`expected ${expected.contractSha256 ?? "unknown"}; actual ${contractSha256}`);
    process.exit(1);
  }
  console.log(`semantics freeze: PASS (${canonical.semanticsVersion} ${contractSha256})`);
}
