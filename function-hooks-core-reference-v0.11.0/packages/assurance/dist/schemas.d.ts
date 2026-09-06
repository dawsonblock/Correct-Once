export interface ValueSchema<T = unknown> {
    readonly name: string;
    validate(value: unknown, path?: string): readonly string[];
    readonly __type?: T;
}
export interface ObjectSchemaOptions {
    readonly allowUnknown?: boolean;
}
export type SchemaShape = Readonly<Record<string, ValueSchema>>;
export declare const schema: {
    unknown(name?: string): ValueSchema<unknown>;
    string(name?: string): ValueSchema<string>;
    number(name?: string): ValueSchema<number>;
    boolean(name?: string): ValueSchema<boolean>;
    literal<T extends string | number | boolean | null>(expected: T): ValueSchema<T>;
    array<T>(item: ValueSchema<T>, name?: string): ValueSchema<readonly T[]>;
    optional<T>(inner: ValueSchema<T>): ValueSchema<T | undefined>;
    union<T>(members: readonly ValueSchema[], name?: string): ValueSchema<T>;
    object<T extends Record<string, unknown>>(shape: SchemaShape, options?: ObjectSchemaOptions, name?: string): ValueSchema<T>;
};
export declare function assertSchema(schemaValue: ValueSchema | undefined, value: unknown, label: string): void;
//# sourceMappingURL=schemas.d.ts.map