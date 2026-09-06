/** Adapts a stable Runtime to the origin-string dispatch port used by isolated child RPC. */
export function kernelIsolationPort(runtime) {
    return Object.freeze({
        dispatch: (event, input, origin) => runtime.dispatch(event, input, origin === undefined ? {} : { origin }),
    });
}
/** Late-binding port for loaders that must register hooks before builder.build() produces a Runtime. */
export function deferredIsolationPort() {
    let bound;
    return {
        port: { dispatch: (event, input, origin) => { if (!bound)
                return Promise.reject(new Error("Isolation runtime port is not bound yet.")); return bound.dispatch(event, input, origin); } },
        bind(runtime) { if (bound)
            throw new Error("Isolation runtime port is already bound."); bound = kernelIsolationPort(runtime); },
    };
}
//# sourceMappingURL=kernel-adapter.js.map