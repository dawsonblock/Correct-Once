# Migration to split packages (0.5)

Version 0.5 extracts every non-kernel subsystem proposed in the minimal stable-kernel plan into an independently publishable workspace package. The root package remains a compatibility umbrella.

## Dependency direction

`core` has no Function Hooks package dependencies. `events` and `assurance` depend only on core. `audit` and `replay` depend on core + assurance. `plugins` depends on core + assurance. `isolation` depends on core + plugins. `enterprise` depends on core + assurance + audit. The automated package-boundary check fails on reverse or cross-layer imports.

## Legacy compatibility

The old `FunctionHooksRuntime` remains in the umbrella for one migration cycle. Extracted packages accept structural registrar/dispatch ports where old wildcard or `engine.create` semantics are required, so they do not import the umbrella. Root source paths are deprecated re-export shims.

## Stable-kernel adapters

New code should use exact-event adapters: `registerActionReceiptHooks`, `registerAuditHooks`, `registerReplayHooks`, `registerOriginAllowlistHooks`, `applyBlastDoor`, `kernelRegistrar`, and `kernelIsolationPort`. Wildcard hooks and `engine.create` are intentionally not added to core.

## Remaining compatibility debt

Legacy schema-aware blueprint construction and the old assured runtime are still compatibility-only. The next major cleanup is to remove that runtime after downstream consumers migrate to explicit policy adapters.
