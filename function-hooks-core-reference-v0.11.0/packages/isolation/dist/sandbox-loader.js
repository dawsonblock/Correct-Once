import { resolve as resolvePath, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
const pluginRoot = process.env.FH_PLUGIN_ROOT ? resolvePath(process.env.FH_PLUGIN_ROOT) : undefined;
const runtimeRoot = process.env.FH_RUNTIME_ROOT ? resolvePath(process.env.FH_RUNTIME_ROOT) : undefined;
const pluginRootReal = pluginRoot ? realpathSync(pluginRoot) : undefined;
function within(path, root) {
    const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
    return path === root || path.startsWith(prefix);
}
function parentIsPlugin(parentURL) {
    if (!parentURL || !pluginRoot || !parentURL.startsWith("file:"))
        return false;
    try {
        const parentPath = realpathSync(resolvePath(fileURLToPath(parentURL)));
        return pluginRootReal ? within(parentPath, pluginRootReal) : false;
    }
    catch {
        return false;
    }
}
export async function resolve(specifier, context, nextResolve) {
    if (parentIsPlugin(context.parentURL)) {
        if (specifier.startsWith("node:") || ["fs", "net", "http", "https", "tls", "dns", "dgram", "child_process", "worker_threads", "vm", "module", "process"].includes(specifier)) {
            throw new Error(`Ambient builtin import denied in isolated plugin: ${specifier}`);
        }
    }
    const resolved = await nextResolve(specifier, context);
    if (parentIsPlugin(context.parentURL)) {
        if (!resolved.url.startsWith("file:")) {
            throw new Error(`Isolated plugin import must resolve to a file inside the plugin root: ${resolved.url}`);
        }
        const path = resolvePath(fileURLToPath(resolved.url));
        let real;
        try {
            real = realpathSync(path);
        }
        catch {
            throw new Error(`Isolated plugin import cannot be resolved safely: ${path}`);
        }
        if (!pluginRootReal || !within(real, pluginRootReal))
            throw new Error(`Isolated plugin import escapes plugin root: ${real}`);
    }
    // Runtime imports are explicitly trusted; this branch mainly documents the intended split.
    if (runtimeRoot && resolved.url.startsWith("file:")) {
        const path = resolvePath(fileURLToPath(resolved.url));
        if (within(path, runtimeRoot))
            return resolved;
    }
    return resolved;
}
//# sourceMappingURL=sandbox-loader.js.map