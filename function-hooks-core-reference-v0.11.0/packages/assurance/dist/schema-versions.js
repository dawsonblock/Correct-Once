import { SchemaVersionError } from "./errors.js";
import { assertSchema } from "./schemas.js";
function parseSemver(value) {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
    if (!match)
        throw new SchemaVersionError(`Invalid semantic schema version: ${value}`);
    return [Number(match[1]), Number(match[2]), Number(match[3])];
}
function compareSemver(a, b) {
    const av = parseSemver(a);
    const bv = parseSemver(b);
    for (let index = 0; index < 3; index += 1) {
        const delta = av[index] - bv[index];
        if (delta !== 0)
            return delta;
    }
    return 0;
}
export class EventSchemaRegistry {
    #schemas = new Map();
    #migrations = new Map();
    register(schema) {
        parseSemver(schema.version);
        const versions = this.#schemas.get(schema.event) ?? new Map();
        if (versions.has(schema.version))
            throw new SchemaVersionError(`Schema ${schema.event}@${schema.version} is already registered.`);
        versions.set(schema.version, Object.freeze({ ...schema }));
        this.#schemas.set(schema.event, versions);
    }
    registerMigration(migration) {
        parseSemver(migration.from);
        parseSemver(migration.to);
        if (migration.from === migration.to)
            throw new SchemaVersionError("Schema migration source and destination must differ.");
        const list = this.#migrations.get(migration.event) ?? [];
        if (list.some((entry) => entry.from === migration.from && entry.to === migration.to)) {
            throw new SchemaVersionError(`Migration ${migration.event} ${migration.from} -> ${migration.to} is already registered.`);
        }
        list.push(Object.freeze({ ...migration }));
        this.#migrations.set(migration.event, list);
    }
    versions(event) {
        return Object.freeze([...(this.#schemas.get(event)?.keys() ?? [])].sort(compareSemver));
    }
    negotiate(event, offered) {
        const supported = new Set(this.versions(event));
        const overlap = offered.filter((version) => supported.has(version));
        if (overlap.length === 0)
            throw new SchemaVersionError(`No compatible schema version for ${event}.`);
        return [...overlap].sort(compareSemver).at(-1);
    }
    validateInput(event, version, value) {
        const schema = this.#schemas.get(event)?.get(version);
        if (!schema)
            throw new SchemaVersionError(`Unknown schema ${event}@${version}.`);
        assertSchema(schema.inputSchema, value, `${event}@${version}.input`);
    }
    validateResult(event, version, value) {
        const schema = this.#schemas.get(event)?.get(version);
        if (!schema)
            throw new SchemaVersionError(`Unknown schema ${event}@${version}.`);
        assertSchema(schema.resultSchema, value, `${event}@${version}.result`);
    }
    migrateInput(event, from, to, value) {
        if (from === to)
            return value;
        const path = this.#path(event, from, to);
        let current = value;
        this.validateInput(event, from, current);
        for (const migration of path) {
            current = migration.migrateInput(current);
            this.validateInput(event, migration.to, current);
        }
        return current;
    }
    migrateResult(event, from, to, value) {
        if (from === to)
            return value;
        const path = this.#path(event, from, to);
        let current = value;
        this.validateResult(event, from, current);
        for (const migration of path) {
            if (!migration.migrateResult)
                throw new SchemaVersionError(`Migration ${event} ${migration.from} -> ${migration.to} has no result adapter.`);
            current = migration.migrateResult(current);
            this.validateResult(event, migration.to, current);
        }
        return current;
    }
    #path(event, from, to) {
        if (!this.#schemas.get(event)?.has(from))
            throw new SchemaVersionError(`Unknown schema ${event}@${from}.`);
        if (!this.#schemas.get(event)?.has(to))
            throw new SchemaVersionError(`Unknown schema ${event}@${to}.`);
        const edges = this.#migrations.get(event) ?? [];
        const queue = [{ version: from, path: [] }];
        const seen = new Set([from]);
        while (queue.length) {
            const current = queue.shift();
            for (const edge of edges.filter((entry) => entry.from === current.version)) {
                const nextPath = [...current.path, edge];
                if (edge.to === to)
                    return nextPath;
                if (!seen.has(edge.to)) {
                    seen.add(edge.to);
                    queue.push({ version: edge.to, path: nextPath });
                }
            }
        }
        throw new SchemaVersionError(`No migration path for ${event} ${from} -> ${to}.`);
    }
}
//# sourceMappingURL=schema-versions.js.map