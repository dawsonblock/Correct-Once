import type { EventMap, Runtime } from "@function-hooks/core";
import type { IsolationRuntimePort } from "./process-loader.js";
/** Adapts a stable Runtime to the origin-string dispatch port used by isolated child RPC. */
export declare function kernelIsolationPort<M extends EventMap>(runtime: Runtime<M>): IsolationRuntimePort;
/** Late-binding port for loaders that must register hooks before builder.build() produces a Runtime. */
export declare function deferredIsolationPort(): {
    readonly port: IsolationRuntimePort;
    bind<M extends EventMap>(runtime: Runtime<M>): void;
};
//# sourceMappingURL=kernel-adapter.d.ts.map