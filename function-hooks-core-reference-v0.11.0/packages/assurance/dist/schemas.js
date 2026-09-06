import { SchemaValidationError } from "./errors.js";
class BasicSchema {
    name;
    #validator;
    constructor(name, validator) {
        this.name = name;
        this.#validator = validator;
    }
    validate(value, path = "$event") {
        return this.#validator(value, path);
    }
}
function optionalMarker(schemaValue) {
    return Object.assign(schemaValue, { optional: true });
}
function isOptional(schema) {
    return schema.optional === true;
}
export const schema = {
    unknown(name = "unknown") {
        return new BasicSchema(name, () => []);
    },
    string(name = "string") {
        return new BasicSchema(name, (value, path) => typeof value === "string" ? [] : [`${path} must be a string`]);
    },
    number(name = "number") {
        return new BasicSchema(name, (value, path) => typeof value === "number" && Number.isFinite(value) ? [] : [`${path} must be a finite number`]);
    },
    boolean(name = "boolean") {
        return new BasicSchema(name, (value, path) => typeof value === "boolean" ? [] : [`${path} must be a boolean`]);
    },
    literal(expected) {
        return new BasicSchema(JSON.stringify(expected), (value, path) => Object.is(value, expected) ? [] : [`${path} must equal ${JSON.stringify(expected)}`]);
    },
    array(item, name = `array<${item.name}>`) {
        return new BasicSchema(name, (value, path) => {
            if (!Array.isArray(value))
                return [`${path} must be an array`];
            return value.flatMap((entry, index) => item.validate(entry, `${path}[${index}]`));
        });
    },
    optional(inner) {
        return optionalMarker(new BasicSchema(`${inner.name}?`, (value, path) => value === undefined ? [] : inner.validate(value, path)));
    },
    union(members, name = "union") {
        return new BasicSchema(name, (value, path) => {
            if (members.some((member) => member.validate(value, path).length === 0))
                return [];
            return [`${path} does not match any member of ${name}`];
        });
    },
    object(shape, options = {}, name = "object") {
        return new BasicSchema(name, (value, path) => {
            if (value === null || typeof value !== "object" || Array.isArray(value))
                return [`${path} must be an object`];
            const object = value;
            const errors = [];
            for (const [key, member] of Object.entries(shape)) {
                if (!(key in object) && !isOptional(member))
                    errors.push(`${path}.${key} is required`);
                else if (key in object)
                    errors.push(...member.validate(object[key], `${path}.${key}`));
            }
            if (!options.allowUnknown) {
                for (const key of Object.keys(object))
                    if (!(key in shape))
                        errors.push(`${path}.${key} is not allowed`);
            }
            return errors;
        });
    },
};
export function assertSchema(schemaValue, value, label) {
    if (!schemaValue)
        return;
    const errors = schemaValue.validate(value, label);
    if (errors.length > 0) {
        throw new SchemaValidationError(`Schema validation failed for ${schemaValue.name}: ${errors.join("; ")}`);
    }
}
//# sourceMappingURL=schemas.js.map