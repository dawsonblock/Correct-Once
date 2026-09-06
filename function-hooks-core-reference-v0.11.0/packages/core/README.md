# @function-hooks/core

Minimal Function Hooks kernel. This package owns only typed event definitions, deterministic hook dispatch, matching, immutable event forwarding, continuation metadata, lifecycle, cooperative cancellation/deadlines, semantic errors, and engine projection.

It deliberately contains no file/process/container APIs, schema library, audit journal, replay implementation, plugin admission policy, receipt store, or enterprise policy.

See `SEMANTICS.md` for the compatibility contract.


## Conformance

```ts
import { createKernel } from "@function-hooks/core";
import { runKernelConformance } from "@function-hooks/core/conformance";

const report = await runKernelConformance(createKernel);
if (report.failed) throw new Error(JSON.stringify(report));
```

Alternate implementations can pass their own generic kernel factory to the same harness.
