export function deepFreeze(value, seen = new WeakSet()) {
    if (value === null || typeof value !== "object")
        return value;
    const object = value;
    if (seen.has(object))
        return value;
    seen.add(object);
    for (const key of Reflect.ownKeys(object)) {
        const child = object[key];
        deepFreeze(child, seen);
    }
    return Object.freeze(value);
}
export function immutableEvent(value) {
    if (value === null || typeof value !== "object")
        return value;
    // structuredClone enforces a value-oriented event contract and prevents a hook
    // from mutating an object still owned by the caller.
    return deepFreeze(structuredClone(value));
}
//# sourceMappingURL=freeze.js.map