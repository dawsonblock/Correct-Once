/** Stable-kernel audit adapter. Wildcards remain outside core, so event names are explicit. */
export function registerAuditHooks(builder, pluginOrder, events, sink) {
    for (const event of events) {
        builder.on("audit", pluginOrder, event, async (_engine, input, next) => {
            const at = Date.now();
            try {
                const result = await next(input);
                await sink({ origin: next.origin, event: String(next.event), at, input, ...(result === undefined ? {} : { result }) });
                return result;
            }
            catch (error) {
                await sink({ origin: next.origin, event: String(next.event), at, input, error: error instanceof Error ? error.message : String(error) });
                throw error;
            }
        });
    }
}
export function registerHashChainAuditHooks(builder, pluginOrder, events, ledger) {
    registerAuditHooks(builder, pluginOrder, events, (record) => { ledger.append(record); });
}
//# sourceMappingURL=hooks.js.map