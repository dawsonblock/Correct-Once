/**
 * Registration-time validation works by supplying a recorder instead of a live
 * runtime registrar. No hook is dispatched while the module declares hooks.
 */
export async function inspectPluginRegistration(descriptor, load) {
    const events = [];
    const on = (event, arg2, arg3) => {
        const callback = arg3 === undefined ? arg2 : arg3;
        if (typeof callback !== "function")
            throw new TypeError(`Hook callback for ${event} must be a function.`);
        events.push(event);
    };
    for (const moduleName of descriptor.hooks.modules ?? []) {
        const module = await load(`${descriptor.directory}/hooks/${moduleName}`);
        await module.register(on, descriptor.options ?? descriptor.manifest.userConfig);
    }
    return {
        plugin: descriptor.manifest.name,
        modules: [...(descriptor.hooks.modules ?? [])],
        declaredEvents: events,
    };
}
//# sourceMappingURL=validate.js.map