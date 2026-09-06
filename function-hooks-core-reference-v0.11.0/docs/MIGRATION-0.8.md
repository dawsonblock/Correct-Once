# Migration to the v0.8 stable root

Version 0.8 removes legacy compatibility names from the umbrella root. This is intentional pre-1.0 surface cleanup.

## Stable path

```ts
import { createStandardKernel } from "function-hooks-core-reference";

const builder = createStandardKernel({
  promptSubmit: async ({ text }) => ({ normalized: text.trim() }),
});
const runtime = builder.build();
await runtime.start();
```

For the smallest dependency boundary, import `@function-hooks/core` and `@function-hooks/events` directly instead of the umbrella.

## Legacy path

Code that still requires wildcard hooks, schema-bearing legacy blueprints, multi-shot continuation budgets, or `engine.create` must now opt in explicitly:

```ts
import {
  FunctionHooksRuntime,
  registerCorePlugin,
} from "function-hooks-core-reference/compat";
```

or install `@function-hooks/compat` directly.

The following no longer resolve from the umbrella root: `FunctionHooksRuntime`, `registerCorePlugin`, `addEvents`, legacy runtime errors/types, and other wildcard-runtime helpers.

## Why this is a 0.8 change

Leaving deprecated symbols on the root would make the eventual 1.0 package appear to promise two incompatible dispatch models. v0.8 forces the boundary while the project is still pre-1.0 and keeps a deliberate migration escape hatch at `/compat`.
