# @function-hooks/portable

A second, independently implemented runtime for the Function Hooks kernel contract.

Unlike `@function-hooks/core`'s reference runtime, this implementation does **not** use Node `AsyncLocalStorage`. Recursive-dispatch suppression is carried explicitly through per-dispatch engine closures. The source imports only TypeScript contracts from `@function-hooks/core`; it does not import the reference runtime, matcher, freezer, blueprint helper, or semantic error implementations.

```ts
import { createPortableKernel } from "@function-hooks/portable";
import { runKernelConformance } from "@function-hooks/core/conformance";

const report = await runKernelConformance(createPortableKernel);
```

This package exists primarily to prove that the stable semantics are implementable independently. It is also useful where ambient async context is undesirable.
