import type { EngineBlueprint, EventAddition, EventDefinition } from "./types.js";
export declare function emptyBlueprint(): EngineBlueprint;
export type EventAdditionInput = EventDefinition["invoke"] | EventAddition;
export declare function addEvents(below: EngineBlueprint, owner: string, additions: Readonly<Record<string, EventAdditionInput>>): EngineBlueprint;
export declare function filterEvents(below: EngineBlueprint, predicate: (definition: EventDefinition) => boolean): EngineBlueprint;
export declare function validateBlueprintTransition(below: EngineBlueprint, above: EngineBlueprint): void;
//# sourceMappingURL=blueprint.d.ts.map