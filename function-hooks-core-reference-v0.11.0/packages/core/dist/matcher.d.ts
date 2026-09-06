/**
 * Deterministic structural subset matching.
 * - primitive: Object.is(pattern, value)
 * - object: every pattern property must match the corresponding value property
 * - array pattern: logical ANY; an empty array never matches
 */
export declare function substructuralMatch(pattern: unknown, value: unknown): boolean;
//# sourceMappingURL=matcher.d.ts.map