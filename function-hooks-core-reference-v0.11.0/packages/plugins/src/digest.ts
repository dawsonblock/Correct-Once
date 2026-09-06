import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { sha256Hex } from "@function-hooks/assurance";
import type { PluginDescriptor } from "./manifest.js";

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

export async function computePluginDigest(descriptor: PluginDescriptor): Promise<string> {
  const wanted = new Set<string>([
    resolve(descriptor.directory, "plugin.json"),
    resolve(descriptor.directory, "hooks", "hooks.json"),
    ...(descriptor.hooks.modules ?? []).map((moduleName) => resolve(descriptor.directory, "hooks", moduleName)),
  ]);

  // Include transitive files under hooks/ as defense against a hook module importing an unpinned sibling.
  try {
    for (const file of await walk(resolve(descriptor.directory, "hooks"))) wanted.add(file);
  } catch {
    // Descriptor validation/read will report missing directories elsewhere.
  }

  const chunks: string[] = [];
  for (const file of [...wanted].sort()) {
    const data = await readFile(file);
    const rel = relative(descriptor.directory, file).replaceAll("\\", "/");
    chunks.push(`${rel}\0${sha256Hex(data)}\0${data.byteLength}`);
  }
  return sha256Hex(chunks.join("\n"));
}
