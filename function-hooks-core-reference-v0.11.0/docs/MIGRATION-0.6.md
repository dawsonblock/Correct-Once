# Migration to compatibility quarantine (0.6)

Version 0.6 keeps the 0.5 package DAG but physically removes the deprecated assured runtime implementation from the umbrella source tree.

## What moved

The old schema-bearing `FunctionHooksRuntime`, wildcard registration, `engine.create` blueprint fold, legacy blueprint helpers, and `registerCorePlugin()` now live in `@function-hooks/compat`. The umbrella's historical source paths remain as thin deprecated re-export shims so existing imports continue to compile during migration.

`@function-hooks/compat` depends on assurance. No stable package depends on compat, and the package-boundary check rejects any reverse dependency into it.

## Preferred replacement

For applications using the standard event catalog:

```ts
import { createStandardKernel } from "@function-hooks/events";

const builder = createStandardKernel({
  promptSubmit: async ({ text }) => ({ normalized: text.trim() }),
});
builder.on("policy", 0, "prompt.submit", async (_engine, event, next) => next(event));
const runtime = builder.build();
await runtime.start();
```

This path has no wildcard hook and no `engine.create` authority.

## Executable compatibility contract

`@function-hooks/core/conformance` now exports `runKernelConformance(factory)`. The harness executes 18 black-box cases against any implementation of the public builder/runtime shape and returns a machine-readable report. Error categories are compared by semantic class name rather than package-local constructor identity.

## Deprecation deadline

`@function-hooks/compat` is migration-only and is not part of the 1.0 kernel contract. The umbrella will stop re-exporting it at 1.0. Consumers that still require wildcard, multi-shot, schema-bearing blueprint, or `engine.create` semantics must depend on the compatibility package explicitly or redesign those behaviors as higher-layer adapters.
