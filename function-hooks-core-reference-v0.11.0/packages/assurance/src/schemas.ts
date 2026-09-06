import { SchemaValidationError } from "./errors.js";
export interface ValueSchema<T = unknown> {
  readonly name: string;
  validate(value: unknown, path?: string): readonly string[];
  readonly __type?: T;
}

class BasicSchema<T> implements ValueSchema<T> {
  readonly name: string;
  readonly #validator: (value: unknown, path: string) => readonly string[];

  constructor(name: string, validator: (value: unknown, path: string) => readonly string[]) {
    this.name = name;
    this.#validator = validator;
  }

  validate(value: unknown, path = "$event"): readonly string[] {
    return this.#validator(value, path);
  }
}

export interface ObjectSchemaOptions {
  readonly allowUnknown?: boolean;
}

export type SchemaShape = Readonly<Record<string, ValueSchema>>;

function optionalMarker<T>(schemaValue: ValueSchema<T>): ValueSchema<T> & { readonly optional: true } {
  return Object.assign(schemaValue, { optional: true as const });
}

function isOptional(schema: ValueSchema): schema is ValueSchema & { readonly optional: true } {
  return (schema as { optional?: boolean }).optional === true;
}

export const schema = {
  unknown(name = "unknown"): ValueSchema<unknown> {
    return new BasicSchema(name, () => []);
  },

  string(name = "string"): ValueSchema<string> {
    return new BasicSchema(name, (value, path) => typeof value === "string" ? [] : [`${path} must be a string`]);
  },

  number(name = "number"): ValueSchema<number> {
    return new BasicSchema(name, (value, path) => typeof value === "number" && Number.isFinite(value) ? [] : [`${path} must be a finite number`]);
  },

  boolean(name = "boolean"): ValueSchema<boolean> {
    return new BasicSchema(name, (value, path) => typeof value === "boolean" ? [] : [`${path} must be a boolean`]);
  },

  literal<T extends string | number | boolean | null>(expected: T): ValueSchema<T> {
    return new BasicSchema(JSON.stringify(expected), (value, path) => Object.is(value, expected) ? [] : [`${path} must equal ${JSON.stringify(expected)}`]);
  },

  array<T>(item: ValueSchema<T>, name = `array<${item.name}>`): ValueSchema<readonly T[]> {
    return new BasicSchema(name, (value, path) => {
      if (!Array.isArray(value)) return [`${path} must be an array`];
      return value.flatMap((entry, index) => item.validate(entry, `${path}[${index}]`));
    });
  },

  optional<T>(inner: ValueSchema<T>): ValueSchema<T | undefined> {
    return optionalMarker<T | undefined>(new BasicSchema<T | undefined>(`${inner.name}?`, (value, path) => value === undefined ? [] : inner.validate(value, path)));
  },

  union<T>(members: readonly ValueSchema[], name = "union"): ValueSchema<T> {
    return new BasicSchema(name, (value, path) => {
      if (members.some((member) => member.validate(value, path).length === 0)) return [];
      return [`${path} does not match any member of ${name}`];
    });
  },

  object<T extends Record<string, unknown>>(shape: SchemaShape, options: ObjectSchemaOptions = {}, name = "object"): ValueSchema<T> {
    return new BasicSchema(name, (value, path) => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return [`${path} must be an object`];
      const object = value as Record<string, unknown>;
      const errors: string[] = [];
      for (const [key, member] of Object.entries(shape)) {
        if (!(key in object) && !isOptional(member)) errors.push(`${path}.${key} is required`);
        else if (key in object) errors.push(...member.validate(object[key], `${path}.${key}`));
      }
      if (!options.allowUnknown) {
        for (const key of Object.keys(object)) if (!(key in shape)) errors.push(`${path}.${key} is not allowed`);
      }
      return errors;
    });
  },
};

export function assertSchema(schemaValue: ValueSchema | undefined, value: unknown, label: string): void {
  if (!schemaValue) return;
  const errors = schemaValue.validate(value, label);
  if (errors.length > 0) {
    throw new SchemaValidationError(`Schema validation failed for ${schemaValue.name}: ${errors.join("; ")}`);
  }
}
