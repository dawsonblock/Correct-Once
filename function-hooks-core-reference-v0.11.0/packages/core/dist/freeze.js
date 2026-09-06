import { UnsupportedEventValueError } from "./errors.js";
function assertPlainValue(value, seen = new WeakSet()) {
    if (value === null || typeof value !== "object")
        return;
    if (seen.has(value))
        return;
    seen.add(value);
    if (Array.isArray(value)) {
        for (const child of value)
            assertPlainValue(child, seen);
        return;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
        const name = proto?.constructor?.name ?? "unknown";
        throw new UnsupportedEventValueError(`Event values must contain only primitives, arrays, and plain objects; received ${name}.`);
    }
    for (const key of Reflect.ownKeys(value)) {
        assertPlainValue(value[key], seen);
    }
}
export function deepFreeze(value, seen = new WeakSet()) {
    if (value === null || (typeof value !== "object" && typeof value !== "function"))
        return value;
    const object = value;
    if (seen.has(object))
        return value;
    seen.add(object);
    for (const key of Reflect.ownKeys(object)) {
        deepFreeze(object[key], seen);
    }
    return Object.freeze(value);
}
export function immutableEvent(value) {
    let clone;
    try {
        clone = structuredClone(value);
    }
    catch (error) {
        throw new UnsupportedEventValueError("Event value is not structured-cloneable.", { cause: error instanceof Error ? error : undefined });
    }
    assertPlainValue(clone);
    return deepFreeze(clone);
}
//# sourceMappingURL=freeze.js.map