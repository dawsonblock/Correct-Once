# Migration to the minimal kernel (0.4)

## New code

Install `@function-hooks/core`. Define an application `EventMap`, construct an `EngineBlueprint` with `createBlueprint()`, register hooks on a builder, call `build()`, then `start()` and `dispatch()`.

The kernel's `origin` is a diagnostic label only. Authentication, capability identity, plugin identity, and RPC-origin binding belong above the kernel.

## Existing 0.3 consumers

The root `function-hooks-core-reference` package remains a compatibility umbrella. `FunctionHooksRuntime`, `registerCorePlugin()`, schemas, budgets, receipts, isolation, audit, replay, plugin management, and enterprise policy continue to work for the 0.4 migration release. `FunctionHooksRuntime` and `registerCorePlugin()` are marked deprecated in declarations.

For incremental migration, the umbrella exposes `function-hooks-core-reference/kernel` and `function-hooks-core-reference/events` subpaths.

## Semantic differences to account for

The minimal kernel allows one `next()` call per hook. The old assurance runtime can permit more for explicitly configured pure events. If an application relies on multi-shot continuation, keep it on the compatibility runtime until that behavior is redesigned as an explicit extension.

The minimal kernel does not perform schema validation, message-size accounting, durable auditing, receipt handling, replay verification, plugin admission, or enterprise policy. Those are intentionally not omissions to patch back into core; they are higher-layer responsibilities.

## 0.5 migration gate

Before 0.5, internal assurance/plugin/enterprise consumers must be rewritten against the new runtime/builder contracts or explicit adapters. Only then should their source move into independently publishable workspace packages.
