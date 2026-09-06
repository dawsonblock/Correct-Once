import type { ConformanceKernelFactory } from "@function-hooks/core/conformance";
import type { RuntimeTraceRecord } from "@function-hooks/core";
import { createKernel } from "@function-hooks/core";
import { createPortableKernel } from "@function-hooks/portable";

type DiffEvents = {
  "calc.run": {
    input: { readonly x: number; readonly y: number; readonly mode: "a" | "b" | "c" };
    result: number;
  };
};

export interface DifferentialQualificationReport {
  readonly iterations: number;
  readonly comparedDispatches: number;
  readonly failed: number;
  readonly failures: readonly string[];
}

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function normalizeTrace(trace: readonly RuntimeTraceRecord[]) {
  return trace.map(({ phase, plugin, event, origin, detail }) => ({
    phase, ...(plugin === undefined ? {} : { plugin }), event, origin,
    ...(detail?.nextCalls === undefined ? {} : { nextCalls: detail.nextCalls }),
  }));
}

async function exercise(factory: ConformanceKernelFactory, seed: number) {
  const random = rng(seed);
  const trace: RuntimeTraceRecord[] = [];
  const builder = factory<DiffEvents>({ trace: (row) => trace.push(row) });
  builder.defineEngine({ events: new Map([["calc.run", { invoke: ({ x, y }) => x * 31 + y }]]) });

  const hookCount = 3 + Math.floor(random() * 5);
  for (let i = 0; i < hookCount; i += 1) {
    const plugin = `p${i}`;
    const order = Math.floor(random() * 4) * 10;
    const action = Math.floor(random() * 4);
    const delta = 1 + Math.floor(random() * 7);
    const matcherKind = Math.floor(random() * 4);
    const callback = async (_engine: unknown, event: Readonly<{x:number;y:number;mode:"a"|"b"|"c"}>, next: any): Promise<number> => {
      if (action === 0) return next({ ...event, x: event.x + delta });
      if (action === 1) return next({ ...event, y: event.y - delta });
      if (action === 2 && ((event.x + event.y + seed + i) % 11 === 0)) return event.x - event.y + delta;
      return next(event);
    };
    if (matcherKind === 0) builder.on(plugin, order, "calc.run", { mode: "a" }, callback as any);
    else if (matcherKind === 1) builder.on(plugin, order, "calc.run", { mode: ["b", "c"] }, callback as any);
    else if (matcherKind === 2) builder.on(plugin, order, "calc.run", { x: [seed % 13, seed % 17] }, callback as any);
    else builder.on(plugin, order, "calc.run", callback as any);
  }

  const runtime = builder.build();
  await runtime.start();
  const modes = ["a", "b", "c"] as const;
  const outputs=[];
  for (let dispatch = 0; dispatch < 3; dispatch += 1) {
    const input = { x: (seed * 7 + dispatch * 3) % 29, y: (seed * 11 + dispatch) % 23, mode: modes[(seed + dispatch) % 3]! };
    outputs.push(await runtime.dispatch("calc.run", input, { origin: "differential" }));
  }
  await runtime.close();
  return { outputs, trace: normalizeTrace(trace) };
}

export async function runDifferentialQualification(iterations = 256): Promise<DifferentialQualificationReport> {
  const failures: string[] = [];
  for (let seed = 1; seed <= iterations; seed += 1) {
    const [reference, portable] = await Promise.all([exercise(createKernel, seed), exercise(createPortableKernel, seed)]);
    if (JSON.stringify(reference) !== JSON.stringify(portable)) failures.push(`seed ${seed} diverged`);
  }
  return Object.freeze({ iterations, comparedDispatches: iterations * 3, failed: failures.length, failures: Object.freeze(failures) });
}
