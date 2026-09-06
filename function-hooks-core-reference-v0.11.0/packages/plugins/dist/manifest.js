import { readFile, realpath } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { PluginValidationError } from "./errors.js";
const ALLOWED_EXTENSIONS = new Set([".js", ".ts", ".jsx", ".tsx"]);
export async function readPluginDescriptor(directory, options) {
    const manifestPath = resolve(directory, "plugin.json");
    const hooksPath = resolve(directory, "hooks", "hooks.json");
    const [manifestRaw, hooksRaw] = await Promise.all([
        readFile(manifestPath, "utf8"),
        readFile(hooksPath, "utf8"),
    ]);
    const manifest = JSON.parse(manifestRaw);
    const hooks = JSON.parse(hooksRaw);
    validateDescriptor(directory, manifest, hooks);
    await validateDescriptorRealPaths(directory, hooks);
    return { directory, manifest, hooks, ...(options === undefined ? {} : { options }) };
}
export function validateDescriptor(directory, manifest, hooks) {
    if (!manifest.name || typeof manifest.name !== "string")
        throw new PluginValidationError("plugin.json requires a non-empty name.");
    if (manifest.dependencies !== undefined && !Array.isArray(manifest.dependencies))
        throw new PluginValidationError("plugin.json dependencies must be an array.");
    if (hooks.modules !== undefined && !Array.isArray(hooks.modules))
        throw new PluginValidationError("hooks.modules must be an array.");
    const hooksDir = resolve(directory, "hooks");
    for (const moduleName of hooks.modules ?? []) {
        if (typeof moduleName !== "string")
            throw new PluginValidationError("Every hooks.modules entry must be a string.");
        const extension = extname(moduleName);
        if (!ALLOWED_EXTENSIONS.has(extension))
            throw new PluginValidationError(`Unsupported hooks module extension: ${extension}`);
        const target = resolve(hooksDir, moduleName);
        const prefix = hooksDir.endsWith(sep) ? hooksDir : `${hooksDir}${sep}`;
        if (target !== hooksDir && !target.startsWith(prefix))
            throw new PluginValidationError(`Hook module escapes hooks directory: ${moduleName}`);
    }
}
async function validateDescriptorRealPaths(directory, hooks) {
    const hooksDir = await realpath(resolve(directory, "hooks"));
    const prefix = hooksDir.endsWith(sep) ? hooksDir : `${hooksDir}${sep}`;
    for (const moduleName of hooks.modules ?? []) {
        let target;
        try {
            target = await realpath(resolve(directory, "hooks", moduleName));
        }
        catch (error) {
            throw new PluginValidationError(`Hook module cannot be resolved: ${moduleName}`, { cause: error });
        }
        if (target !== hooksDir && !target.startsWith(prefix))
            throw new PluginValidationError(`Hook module resolves outside hooks directory (symlink escape): ${moduleName}`);
    }
}
//# sourceMappingURL=manifest.js.map