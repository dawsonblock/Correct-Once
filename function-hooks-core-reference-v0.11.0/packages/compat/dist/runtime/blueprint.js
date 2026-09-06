import { DuplicateEventError, InvalidBlueprintError } from "./errors.js";
export function emptyBlueprint() {
    return Object.freeze({ events: new Map() });
}
export function addEvents(below, owner, additions) {
    const next = new Map(below.events);
    for (const [name, raw] of Object.entries(additions)) {
        if (next.has(name)) {
            throw new DuplicateEventError(`Event ${name} already exists; plugins may add or withhold events, not replace them.`);
        }
        const addition = typeof raw === "function" ? { invoke: raw } : raw;
        if (typeof addition.invoke !== "function")
            throw new InvalidBlueprintError(`Event ${name} has no invoke function.`);
        next.set(name, Object.freeze({
            name,
            owner,
            invoke: addition.invoke,
            ...(addition.schemaVersion ? { schemaVersion: addition.schemaVersion } : {}),
            ...(addition.inputSchema ? { inputSchema: addition.inputSchema } : {}),
            ...(addition.resultSchema ? { resultSchema: addition.resultSchema } : {}),
            ...(addition.behavior ? { behavior: Object.freeze({ ...addition.behavior }) } : {}),
        }));
    }
    return Object.freeze({ events: next });
}
export function filterEvents(below, predicate) {
    return Object.freeze({ events: new Map([...below.events].filter(([, definition]) => predicate(definition))) });
}
export function validateBlueprintTransition(below, above) {
    if (!(above?.events instanceof Map)) {
        throw new InvalidBlueprintError("engine.create hooks must return an EngineBlueprint with a Map named events.");
    }
    for (const [name, prior] of below.events) {
        const current = above.events.get(name);
        if (current !== undefined && current !== prior) {
            throw new InvalidBlueprintError(`Event ${name} was replaced. Existing event definitions are immutable.`);
        }
    }
    for (const [name, definition] of above.events) {
        if (definition.name !== name || typeof definition.owner !== "string" || typeof definition.invoke !== "function") {
            throw new InvalidBlueprintError(`Malformed event definition for ${name}.`);
        }
    }
}
//# sourceMappingURL=blueprint.js.map