import { canonicalJson, sha256Hex } from "@function-hooks/assurance";
import { ReplayMismatchError } from "./errors.js";
export class ReplayLog {
    #records = [];
    append(record) {
        const sequence = this.#records.length;
        const recordHash = sha256Hex(canonicalJson({ sequence, ...record }));
        const full = Object.freeze({ sequence, ...record, recordHash });
        this.#records.push(full);
        return full;
    }
    records() { return Object.freeze([...this.#records]); }
    verify() {
        for (let index = 0; index < this.#records.length; index += 1) {
            const record = this.#records[index];
            const { recordHash, ...rest } = record;
            if (record.sequence !== index || sha256Hex(canonicalJson(rest)) !== recordHash)
                return { ok: false, index };
        }
        return { ok: true };
    }
}
export function registerReplayRecorder(runtime, pluginOrder, log, context = {}, options = {}) {
    const on = runtime.registrar("enterprise-replay-recorder", pluginOrder);
    on("*", async (_$, event, next) => {
        if (options.events && !options.events.has(next.event))
            return next(event);
        const at = Date.now();
        try {
            const result = await next(event);
            log.append({ at, event: next.event, origin: next.origin, input: event, ...(result === undefined ? {} : { result }), context });
            return result;
        }
        catch (error) {
            log.append({ at, event: next.event, origin: next.origin, input: event, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error), context });
            throw error;
        }
    });
}
/** Replay is intended for pure/mock adapters. It deliberately refuses recorded failures. */
export async function replayAndVerify(runtime, record) {
    if (record.error)
        throw new ReplayMismatchError(`Recorded dispatch ${record.sequence} failed originally; automatic replay is disabled.`);
    const result = await runtime.dispatch(record.event, record.input, record.origin);
    if (canonicalJson(result) !== canonicalJson(record.result)) {
        throw new ReplayMismatchError(`Replay mismatch for record ${record.sequence} (${record.event}).`);
    }
    return result;
}
/** Stable-kernel recorder for explicit events. */
export function registerReplayHooks(builder, pluginOrder, events, log, context = {}) {
    for (const event of events)
        builder.on("replay-recorder", pluginOrder, event, async (_engine, input, next) => {
            const at = Date.now();
            try {
                const result = await next(input);
                log.append({ at, event: String(next.event), origin: next.origin, input, ...(result === undefined ? {} : { result }), context });
                return result;
            }
            catch (error) {
                log.append({ at, event: String(next.event), origin: next.origin, input, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error), context });
                throw error;
            }
        });
}
export async function replayKernelRecord(runtime, record) {
    if (record.error)
        throw new ReplayMismatchError(`Recorded dispatch ${record.sequence} failed originally; automatic replay is disabled.`);
    const result = await runtime.dispatch(record.event, record.input, { origin: record.origin });
    if (canonicalJson(result) !== canonicalJson(record.result))
        throw new ReplayMismatchError(`Replay mismatch for record ${record.sequence} (${record.event}).`);
    return result;
}
//# sourceMappingURL=replay.js.map