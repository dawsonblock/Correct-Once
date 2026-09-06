import { type ValueSchema } from "./schemas.js";
export interface EventSchemaVersion {
    readonly event: string;
    readonly version: string;
    readonly inputSchema?: ValueSchema;
    readonly resultSchema?: ValueSchema;
}
export interface SchemaMigration {
    readonly event: string;
    readonly from: string;
    readonly to: string;
    readonly migrateInput: (value: unknown) => unknown;
    readonly migrateResult?: (value: unknown) => unknown;
}
export declare class EventSchemaRegistry {
    #private;
    register(schema: EventSchemaVersion): void;
    registerMigration(migration: SchemaMigration): void;
    versions(event: string): readonly string[];
    negotiate(event: string, offered: readonly string[]): string;
    validateInput(event: string, version: string, value: unknown): void;
    validateResult(event: string, version: string, value: unknown): void;
    migrateInput(event: string, from: string, to: string, value: unknown): unknown;
    migrateResult(event: string, from: string, to: string, value: unknown): unknown;
}
//# sourceMappingURL=schema-versions.d.ts.map