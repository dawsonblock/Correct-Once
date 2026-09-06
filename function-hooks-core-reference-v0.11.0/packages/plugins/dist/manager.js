import { resolvePluginOrder } from "./order.js";
import { admitPinnedPlugins } from "./admission.js";
import { registerPluginModules, TrustedInProcessLoader } from "./loader.js";
export async function registerPlugins(runtime, descriptors, managed = {}, loader = new TrustedInProcessLoader()) {
    const order = resolvePluginOrder(descriptors.map((descriptor) => ({
        name: descriptor.manifest.name,
        ...(descriptor.manifest.dependencies === undefined ? {} : { dependencies: descriptor.manifest.dependencies }),
    })), managed);
    const byName = new Map(descriptors.map((descriptor) => [descriptor.manifest.name, descriptor]));
    const registered = [];
    for (let index = 0; index < order.length; index += 1) {
        const name = order[index];
        const descriptor = byName.get(name);
        await registerPluginModules(descriptor, runtime.registrar(name, index), loader);
        registered.push(name);
    }
    return Object.freeze({ order: Object.freeze(order), registered: Object.freeze(registered) });
}
/**
 * Two-stage registration helper: verify a sealed managed configuration and exact
 * plugin digests before executing any candidate hook module, then register only
 * the admitted set in the sealed prepend/dependency/append order.
 */
export async function registerPluginsAssured(runtime, descriptors, sealed, options = {}) {
    const admission = await admitPinnedPlugins(descriptors, sealed, options.publicKeyPem);
    const registered = await registerPlugins(runtime, descriptors, {
        ...(sealed.config.prepend ? { prepend: sealed.config.prepend } : {}),
        ...(sealed.config.append ? { append: sealed.config.append } : {}),
    }, options.loader ?? new TrustedInProcessLoader());
    return Object.freeze({ ...registered, admission });
}
//# sourceMappingURL=manager.js.map