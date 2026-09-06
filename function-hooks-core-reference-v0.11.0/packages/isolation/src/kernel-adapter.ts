import type { EventMap, EventName, Runtime } from "@function-hooks/core";
import type { IsolationRuntimePort } from "./process-loader.js";

/** Adapts a stable Runtime to the origin-string dispatch port used by isolated child RPC. */
export function kernelIsolationPort<M extends EventMap>(runtime: Runtime<M>): IsolationRuntimePort {
  return Object.freeze({
    dispatch: (event: string, input: unknown, origin?: string) => runtime.dispatch(event as EventName<M>, input as never, origin === undefined ? {} : { origin }) as Promise<unknown>,
  });
}

/** Late-binding port for loaders that must register hooks before builder.build() produces a Runtime. */
export function deferredIsolationPort(): { readonly port: IsolationRuntimePort; bind<M extends EventMap>(runtime: Runtime<M>): void } {
  let bound: IsolationRuntimePort | undefined;
  return {
    port: { dispatch: (event, input, origin) => { if (!bound) return Promise.reject(new Error("Isolation runtime port is not bound yet.")); return bound.dispatch(event, input, origin); } },
    bind(runtime) { if (bound) throw new Error("Isolation runtime port is already bound."); bound = kernelIsolationPort(runtime); },
  };
}
