import type { EventMap, KernelBuilder, KernelOptions } from "@function-hooks/core";
/**
 * Independent kernel implementation. Only public TypeScript contracts are
 * imported from @function-hooks/core; no reference-runtime code is reused.
 */
export declare function createPortableKernel<M extends EventMap>(options?: KernelOptions<M>): KernelBuilder<M>;
//# sourceMappingURL=index.d.ts.map