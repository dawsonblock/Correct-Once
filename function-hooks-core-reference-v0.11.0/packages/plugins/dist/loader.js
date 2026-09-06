import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
/**
 * Trusted development loader. It imports a plugin in the host Node process.
 * This is intentionally NOT represented as a security boundary.
 */
export class TrustedInProcessLoader {
    async load(modulePath) {
        const loaded = await import(pathToFileURL(modulePath).href);
        if (typeof loaded.register !== "function")
            throw new TypeError(`${modulePath} must export register(on, options).`);
        return loaded;
    }
}
export async function registerPluginModules(descriptor, on, loader) {
    for (const moduleName of descriptor.hooks.modules ?? []) {
        const path = resolve(descriptor.directory, "hooks", moduleName);
        const module = await loader.load(path, { pluginName: descriptor.manifest.name });
        await module.register(on, descriptor.options ?? descriptor.manifest.userConfig);
    }
}
//# sourceMappingURL=loader.js.map