import type { EngineBlueprint, EngineEvent, EventMap, EventName } from "./types.js";
export declare function createBlueprint<M extends EventMap>(events: Readonly<{
    [K in EventName<M>]: EngineEvent<M, K>;
}>): EngineBlueprint<M>;
export declare function validateBlueprint<M extends EventMap>(blueprint: EngineBlueprint<M>): void;
export declare function validateEventName(name: string): void;
export declare function snapshotBlueprint<M extends EventMap>(blueprint: EngineBlueprint<M>): EngineBlueprint<M>;
//# sourceMappingURL=blueprint.d.ts.map