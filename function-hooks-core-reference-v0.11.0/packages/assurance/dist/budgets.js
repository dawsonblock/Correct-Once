const DEFAULTS = Object.freeze({
    deadlineMs: 30_000,
    maxInputBytes: 1_048_576,
    maxResultBytes: 4_194_304,
    maxNextCalls: 16,
});
export class BudgetController {
    #config;
    constructor(config = {}) {
        this.#config = config;
    }
    limitsFor(eventName, definition) {
        const event = this.#config.perEvent?.[eventName] ?? {};
        const behaviorMax = definition.behavior?.maxNextCalls;
        const nonIdempotentCap = definition.behavior?.sideEffect === true && definition.behavior.idempotent !== true ? 1 : undefined;
        const configured = event.maxNextCalls ?? this.#config.defaults?.maxNextCalls ?? DEFAULTS.maxNextCalls;
        return Object.freeze({
            deadlineMs: positive(event.deadlineMs ?? this.#config.defaults?.deadlineMs ?? DEFAULTS.deadlineMs, "deadlineMs"),
            maxInputBytes: positive(event.maxInputBytes ?? this.#config.defaults?.maxInputBytes ?? DEFAULTS.maxInputBytes, "maxInputBytes"),
            maxResultBytes: positive(event.maxResultBytes ?? this.#config.defaults?.maxResultBytes ?? DEFAULTS.maxResultBytes, "maxResultBytes"),
            maxNextCalls: positive(behaviorMax ?? nonIdempotentCap ?? configured, "maxNextCalls"),
        });
    }
}
function positive(value, name) {
    if (!Number.isInteger(value) || value <= 0)
        throw new TypeError(`${name} must be a positive integer.`);
    return value;
}
//# sourceMappingURL=budgets.js.map