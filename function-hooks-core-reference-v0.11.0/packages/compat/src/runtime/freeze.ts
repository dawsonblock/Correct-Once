export function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);

  for (const key of Reflect.ownKeys(object)) {
    const child = (object as Record<PropertyKey, unknown>)[key];
    deepFreeze(child, seen);
  }
  return Object.freeze(value);
}

export function immutableEvent<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  // structuredClone enforces a value-oriented event contract and prevents a hook
  // from mutating an object still owned by the caller.
  return deepFreeze(structuredClone(value));
}
