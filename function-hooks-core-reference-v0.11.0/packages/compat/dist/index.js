/**
 * Deprecated v0.x compatibility surface.
 *
 * New applications should use @function-hooks/core and the explicit higher-layer
 * adapters. This package exists solely to isolate the schema-bearing wildcard /
 * engine.create runtime during migration.
 */
export * from "./runtime/types.js";
export * from "./runtime/errors.js";
export * from "./runtime/freeze.js";
export * from "./runtime/matcher.js";
export * from "./runtime/blueprint.js";
export * from "./runtime/runtime.js";
export { registerCorePlugin } from "./core.js";
//# sourceMappingURL=index.js.map