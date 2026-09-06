# @function-hooks/compat

Deprecated migration package for the pre-kernel Function Hooks runtime.

It contains the old schema-bearing `FunctionHooksRuntime`, wildcard hooks,
`engine.create` blueprint fold, and `registerCorePlugin()` catalog binder. New
code should not depend on this package. Use `@function-hooks/core` plus explicit
adapters from the higher-layer packages.

The package exists so the compatibility implementation is no longer part of the
umbrella package's own source tree and can be removed independently in the next
major version.
