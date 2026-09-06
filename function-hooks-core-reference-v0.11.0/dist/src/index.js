/**
 * Function Hooks pre-1.0 distribution facade.
 *
 * The root surface is intentionally free of legacy wildcard / engine.create
 * compatibility symbols. Existing 0.x consumers that still require those
 * semantics must import the explicit `function-hooks-core-reference/compat`
 * subpath or install `@function-hooks/compat` directly.
 */
export * from "@function-hooks/core";
export { createPortableKernel } from "@function-hooks/portable";
export { createStandardEventBlueprint, createStandardKernel } from "@function-hooks/events";
export * from "@function-hooks/assurance";
export * from "@function-hooks/audit";
export * from "@function-hooks/replay";
export { resolvePluginOrder, readPluginDescriptor, validateDescriptor, computePluginDigest, admitPinnedPlugins, inspectPluginRegistration, TrustedInProcessLoader, registerPluginModules, registerPlugins, registerPluginsAssured, FileActivationReceiptSink, RuntimeGenerationManager, kernelRegistrar, registerPluginsIntoKernel, PluginOrderError, PluginValidationError, GenerationActivationError, KernelPluginCompatibilityError, } from "@function-hooks/plugins";
export * from "@function-hooks/isolation";
export * from "./ui/surfaces.js";
export * from "@function-hooks/enterprise";
export * as assurance from "@function-hooks/assurance";
export * as audit from "@function-hooks/audit";
export * as replay from "@function-hooks/replay";
export * as plugins from "@function-hooks/plugins";
export * as isolation from "@function-hooks/isolation";
export * as enterprise from "@function-hooks/enterprise";
export * as portable from "@function-hooks/portable";
/** Production-shaped agent action gateway. Prefer installing `@function-hooks/gateway` directly. */
export * from "@function-hooks/gateway";
export * as gateway from "@function-hooks/gateway";
/** Canonical discovered/admitted capability model and registry. */
export * from "@function-hooks/capabilities";
export * as capabilities from "@function-hooks/capabilities";
/** App/capability routing above the gateway. Prefer installing `@function-hooks/router` directly. */
export * from "@function-hooks/router";
export * as router from "@function-hooks/router";
//# sourceMappingURL=index.js.map