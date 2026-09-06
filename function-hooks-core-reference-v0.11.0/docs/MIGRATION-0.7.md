# Migration to dual-runtime qualification (0.7)

Version 0.7 does not intentionally change application-facing hook semantics from the 0.6 candidate. It changes the evidence behind those semantics.

## New package: `@function-hooks/portable`

Applications that need the standard reference runtime should continue using:

```ts
import { createKernel } from "@function-hooks/core";
```

To exercise the independent implementation instead:

```ts
import { createPortableKernel } from "@function-hooks/portable";
```

Both functions return the same public `KernelBuilder` contract. The portable package imports only core TypeScript contracts and uses an independent runtime implementation.

## Conformance label

`runKernelConformance()` now reports `semanticsVersion: "1.0-rc.1"` and runs 21 cases. The additional cases lock matcher array semantics, immutable `next` metadata, and default runtime deadlines. The harness no longer calls the reference `createBlueprint()` helper when constructing fixtures.

## Compatibility users

No migration is forced for `@function-hooks/compat` in 0.7. It remains deprecated. New code should still prefer `@function-hooks/core`/`@function-hooks/events` plus explicit assurance and policy adapters.

## Important limitation

The name `portable` refers to the implementation strategy: it avoids Node ambient async-context machinery. This release does not claim that browser, Deno, or Bun execution has been qualified.
