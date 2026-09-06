import { DuplicateEventError, InvalidBlueprintError, InvalidEventNameError } from "./errors.js";
import type { EngineBlueprint, EngineEvent, EventMap, EventName } from "./types.js";

export function createBlueprint<M extends EventMap>(
  events: Readonly<{ [K in EventName<M>]: EngineEvent<M, K> }>,
): EngineBlueprint<M> {
  const map = new Map<EventName<M>, EngineEvent<M, any>>();
  for (const [name, definition] of Object.entries(events) as [EventName<M>, EngineEvent<M, any>][]) {
    validateEventName(name);
    if (map.has(name)) throw new DuplicateEventError(`Event ${name} is defined more than once.`);
    if (!definition || typeof definition.invoke !== "function") {
      throw new InvalidBlueprintError(`Event ${name} must define an invoke function.`);
    }
    map.set(name, Object.freeze({ invoke: definition.invoke }));
  }
  return Object.freeze({ events: map });
}

export function validateBlueprint<M extends EventMap>(blueprint: EngineBlueprint<M>): void {
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

export function validateEventName(name: string): void {
  const parts = name.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new InvalidEventNameError(`Event ${name} must use the exact noun.verb form.`);
  }
}

export function snapshotBlueprint<M extends EventMap>(blueprint: EngineBlueprint<M>): EngineBlueprint<M> {
  validateBlueprint(blueprint);
  const events = new Map<EventName<M>, EngineEvent<M, any>>();
  for (const [name, definition] of blueprint.events) {
    events.set(name, Object.freeze({ invoke: definition.invoke }));
  }
  return Object.freeze({ events });
}
