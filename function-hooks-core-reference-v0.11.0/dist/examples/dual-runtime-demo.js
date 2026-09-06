import { createKernel } from "@function-hooks/core";
import { createPortableKernel } from "@function-hooks/portable";
async function exercise(label, factory) {
    const trace = [];
    const builder = factory({ trace: (row) => trace.push(row) });
    builder.defineEngine({
        events: new Map([
            ["math.add", { invoke: ({ a, b }) => a + b }],
        ]),
    });
    builder.on("offset", 0, "math.add", async (_engine, event, next) => next({ ...event, a: event.a + 10 }));
    builder.on("audit", 1, "math.add", async (_engine, event, next) => next(event));
    const runtime = builder.build();
    await runtime.start();
    const result = await runtime.dispatch("math.add", { a: 2, b: 3 }, { origin: "dual-runtime-demo" });
    await runtime.close();
    return {
        label,
        result,
        trace: trace.map(({ phase, plugin }) => plugin === undefined ? { phase } : { phase, plugin }),
    };
}
const reference = await exercise("reference", createKernel);
const portable = await exercise("portable", createPortableKernel);
if (reference.result !== portable.result || JSON.stringify(reference.trace) !== JSON.stringify(portable.trace)) {
    console.error(JSON.stringify({ reference, portable }, null, 2));
    process.exitCode = 1;
}
else {
    console.log(`dual runtime equivalence: PASS — result=${reference.result}, observable trace identical`);
}
//# sourceMappingURL=dual-runtime-demo.js.map