import { DuplicateEventError, InvalidBlueprintError, InvalidEventNameError } from "./errors.js";
export function createBlueprint(events) {
    const map = new Map();
    for (const [name, definition] of Object.entries(events)) {
        validateEventName(name);
        if (map.has(name))
            throw new DuplicateEventError(`Event ${name} is defined more than once.`);
        if (!definition || typeof definition.invoke !== "function") {
            throw new InvalidBlueprintError(`Event ${name} must define an invoke function.`);
        }
        map.set(name, Object.freeze({ invoke: definition.invoke }));
    }
    return Object.freeze({ events: map });
}
export function validateBlueprint(blueprint) {
    if (!(blueprint?.events instanceof Map)) {
        throw new InvalidBlueprintError("EngineBlueprint.events must be a Map.");
    }
    for (const [name, definition] of blueprint.events) {
        validateEventName(name);
        if (!definition || typeof definition.invoke !== "function") {
            throw new InvalidBlueprintError(`Event ${name} must define an invoke function.`);
        }
    }
}
export function validateEventName(name) {
    const parts = name.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new InvalidEventNameError(`Event ${name} must use the exact noun.verb form.`);
    }
}
export function snapshotBlueprint(blueprint) {
    validateBlueprint(blueprint);
    const events = new Map();
    for (const [name, definition] of blueprint.events) {
        events.set(name, Object.freeze({ invoke: definition.invoke }));
    }
    return Object.freeze({ events });
}
//# sourceMappingURL=blueprint.js.map