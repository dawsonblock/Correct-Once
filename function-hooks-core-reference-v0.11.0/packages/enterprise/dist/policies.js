function filterLegacyEvents(below, predicate) { return Object.freeze({ events: new Map([...below.events].filter(([, definition]) => predicate(definition))) }); }
export function registerAuditPlugin(runtime, pluginOrder, sink) {
    const on = runtime.registrar("enterprise-audit", pluginOrder);
    on("*", async (_$, event, next) => {
        const at = Date.now();
        try {
            const result = await next(event);
            await sink({ origin: next.origin, event: next.event, at, input: event, ...(result === undefined ? {} : { result }) });
            return result;
        }
        catch (error) {
            await sink({ origin: next.origin, event: next.event, at, input: event, error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    });
}
export function registerHashChainAuditPlugin(runtime, pluginOrder, ledger) {
    registerAuditPlugin(runtime, pluginOrder, async (record) => { ledger.append(record); });
}
export function registerBlastDoorPlugin(runtime, pluginOrder, allowedEvents) {
    const on = runtime.registrar("enterprise-blast-door", pluginOrder);
    on("engine.create", async (_$, event, next) => {
        const below = await next(event);
        return filterLegacyEvents(below, (definition) => allowedEvents.has(definition.name));
    });
}
export function registerOriginAllowlistPlugin(runtime, pluginOrder, rules) {
    const on = runtime.registrar("enterprise-origin-allowlist", pluginOrder);
    on("*", async (_$, event, next) => {
        const allowed = rules[next.event];
        if (allowed && !allowed.includes(next.origin))
            throw new Error(`Origin ${next.origin} is not permitted to call ${next.event}.`);
        return next(event);
    });
}
export function collectTrace(records) {
    return (record) => { records.push(record); };
}
/** Stable-kernel blast door: filter a blueprint before defineEngine(). */
export function applyBlastDoor(blueprint, allowedEvents) {
    return Object.freeze({ events: new Map([...blueprint.events].filter(([name]) => allowedEvents.has(name))) });
}
/** Stable-kernel origin policy for explicit rules. Kernel origins remain diagnostic labels, not authenticated identities. */
export function registerOriginAllowlistHooks(builder, pluginOrder, rules) {
    for (const [name, allowed] of Object.entries(rules)) {
        builder.on("enterprise-origin-allowlist", pluginOrder, name, async (_engine, input, next) => {
            if (!allowed.includes(next.origin))
                throw new Error(`Origin ${next.origin} is not permitted to call ${String(next.event)}.`);
            return next(input);
        });
    }
}
//# sourceMappingURL=policies.js.map