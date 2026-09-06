function isPlainObject(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}
export function substructuralMatch(pattern, value) {
    if (Array.isArray(pattern)) {
        if (pattern.length === 0)
            return false;
        return pattern.some((candidate) => substructuralMatch(candidate, value));
    }
    if (isPlainObject(pattern)) {
        if (!isPlainObject(value))
            return false;
        return Object.entries(pattern).every(([key, childPattern]) => Object.prototype.hasOwnProperty.call(value, key) && substructuralMatch(childPattern, value[key]));
    }
    return Object.is(pattern, value);
}
//# sourceMappingURL=matcher.js.map