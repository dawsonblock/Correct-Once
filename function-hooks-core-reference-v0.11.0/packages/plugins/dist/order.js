import { PluginOrderError } from "./errors.js";
function unique(names, label) {
    const set = new Set();
    for (const name of names) {
        if (set.has(name))
            throw new PluginOrderError(`Duplicate plugin ${name} in ${label}.`);
        set.add(name);
    }
    return [...set];
}
export function resolvePluginOrder(plugins, managed = {}) {
    const byName = new Map(plugins.map((plugin) => [plugin.name, plugin]));
    if (byName.size !== plugins.length)
        throw new PluginOrderError("Plugin names must be unique.");
    const prepend = unique(managed.prepend ?? [], "prepend");
    const append = unique(managed.append ?? [], "append");
    const managedNames = new Set([...prepend, ...append]);
    for (const name of managedNames) {
        if (!byName.has(name))
            throw new PluginOrderError(`Managed ordering references unknown plugin ${name}.`);
    }
    for (const name of prepend) {
        if (append.includes(name))
            throw new PluginOrderError(`Plugin ${name} cannot be both prepended and appended.`);
    }
    const middle = plugins.filter((plugin) => !managedNames.has(plugin.name));
    const middleNames = new Set(middle.map((plugin) => plugin.name));
    const indegree = new Map();
    const outgoing = new Map();
    for (const plugin of middle) {
        indegree.set(plugin.name, 0);
        outgoing.set(plugin.name, []);
    }
    for (const plugin of middle) {
        for (const dependency of plugin.dependencies ?? []) {
            if (!byName.has(dependency))
                throw new PluginOrderError(`${plugin.name} depends on missing plugin ${dependency}.`);
            if (!middleNames.has(dependency))
                continue; // managed position is authoritative
            outgoing.get(dependency).push(plugin.name);
            indegree.set(plugin.name, indegree.get(plugin.name) + 1);
        }
    }
    const queue = middle.filter((plugin) => indegree.get(plugin.name) === 0).map((plugin) => plugin.name);
    const sorted = [];
    while (queue.length > 0) {
        const name = queue.shift();
        sorted.push(name);
        for (const dependent of outgoing.get(name) ?? []) {
            indegree.set(dependent, indegree.get(dependent) - 1);
            if (indegree.get(dependent) === 0)
                queue.push(dependent);
        }
    }
    if (sorted.length !== middle.length)
        throw new PluginOrderError("Plugin dependency cycle detected.");
    return [...prepend, ...sorted, ...append];
}
//# sourceMappingURL=order.js.map