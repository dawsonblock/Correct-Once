# @function-hooks/events

Optional standard event catalog for Function Hooks. It is intentionally separate from `@function-hooks/core`: applications may define their own event maps and never install this package.

`createStandardEventBlueprint()` binds the catalog to host adapters. Missing side-effecting host adapters fail closed.


For the shortest stable bootstrap path, `createStandardKernel(adapters, options)` returns a builder with the standard blueprint already defined. Register exact-event hooks, call `build()`, then `start()`. This is the preferred migration replacement for the deprecated `FunctionHooksRuntime + registerCorePlugin()` pair.
