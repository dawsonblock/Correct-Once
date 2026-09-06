import type { EventMap, HookDescriptor, KernelBuilder, KernelOptions } from "./types.js";
export declare function createKernel<M extends EventMap>(options?: KernelOptions<M>): KernelBuilder<M>;
export declare function describeHooks<M extends EventMap>(builder: KernelBuilder<M>): readonly HookDescriptor<M>[];
//# sourceMappingURL=runtime.d.ts.map