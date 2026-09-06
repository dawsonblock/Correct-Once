import { KernelPluginCompatibilityError } from "./errors.js";
import { registerPluginModules, TrustedInProcessLoader } from "./loader.js";
import { resolvePluginOrder } from "./order.js";
/** Converts the stable builder into the legacy plugin register(on) shape for exact dispatch hooks. */
export function kernelRegistrar(builder, plugin, order) {
    return ((event, arg2, arg3) => {
        if (event === "*" || event === "engine.create")
            throw new KernelPluginCompatibilityError(`Plugin ${plugin} uses ${event}, which is not part of the stable kernel registrar contract.`);
        const matcher = arg3 === undefined ? undefined : arg2;
        const callback = (arg3 === undefined ? arg2 : arg3);
        if (typeof callback !== "function")
            throw new TypeError(`Hook callback for ${event} must be a function.`);
        if (matcher === undefined)
            builder.on(plugin, order, event, callback);
        else
            builder.on(plugin, order, event, matcher, callback);
    });
}
export async function registerPluginsIntoKernel(builder, descriptors, managed = {}, loader = new TrustedInProcessLoader()) {
    const order = resolvePluginOrder(descriptors.map((d) => ({ name: d.manifest.name, ...(d.manifest.dependencies ? { dependencies: d.manifest.dependencies } : {}) })), managed);
    const byName = new Map(descriptors.map((d) => [d.manifest.name, d]));
    const registered = [];
    for (let index = 0; index < order.length; index++) {
        const name = order[index];
        const descriptor = byName.get(name);
        await registerPluginModules(descriptor, kernelRegistrar(builder, name, index), loader);
        registered.push(name);
    }
    return Object.freeze({ order: Object.freeze(order), registered: Object.freeze(registered) });
}
//# sourceMappingURL=kernel-adapter.js.map