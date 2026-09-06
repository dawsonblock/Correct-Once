import { canonicalJson, sha256Hex } from "@function-hooks/assurance";
import { ReplayMismatchError } from "./errors.js";
export interface ReplayNext { (event: unknown): Promise<unknown>; readonly event: string; readonly origin: string; readonly signal: AbortSignal; }
export interface ReplayRegistrar { (event: string, callback: (engine: unknown, event: unknown, next: ReplayNext) => unknown | Promise<unknown>): void; (event: string, matcher: unknown, callback: (engine: unknown, event: unknown, next: ReplayNext) => unknown | Promise<unknown>): void; }
export interface ReplayRuntimePort { registrar(plugin: string, order: number): ReplayRegistrar; dispatch(event: string, input: unknown, explicitOrigin?: string): Promise<unknown>; }

export interface ReplayContext {
  readonly configHash?: string;
  readonly pluginSetHash?: string;
  readonly generationId?: string;
}

export interface ReplayRecord {
  readonly sequence: number;
  readonly at: number;
  readonly event: string;
  readonly origin: string;
  readonly input: unknown;
  readonly result?: unknown;
  readonly error?: string;
  readonly context: ReplayContext;
  readonly recordHash: string;
}

export class ReplayLog {
  readonly #records: ReplayRecord[] = [];

  append(record: Omit<ReplayRecord, "sequence" | "recordHash">): ReplayRecord {
    const sequence = this.#records.length;
    const recordHash = sha256Hex(canonicalJson({ sequence, ...record }));
    const full = Object.freeze({ sequence, ...record, recordHash });
    this.#records.push(full);
    return full;
  }

  records(): readonly ReplayRecord[] { return Object.freeze([...this.#records]); }

  verify(): { readonly ok: true } | { readonly ok: false; readonly index: number } {
    for (let index = 0; index < this.#records.length; index += 1) {
      const record = this.#records[index]!;
      const { recordHash, ...rest } = record;
      if (record.sequence !== index || sha256Hex(canonicalJson(rest)) !== recordHash) return { ok: false, index };
    }
    return { ok: true };
  }
}

export function registerReplayRecorder(
  runtime: ReplayRuntimePort,
  pluginOrder: number,
  log: ReplayLog,
  context: ReplayContext = {},
  options: { readonly events?: ReadonlySet<string> } = {},
): void {
  const on = runtime.registrar("enterprise-replay-recorder", pluginOrder);
  on("*", async (_$, event, next) => {
    if (options.events && !options.events.has(next.event)) return next(event);
    const at = Date.now();
    try {
      const result = await next(event);
      log.append({ at, event: next.event, origin: next.origin, input: event, ...(result === undefined ? {} : { result }), context });
      return result;
    } catch (error) {
      log.append({ at, event: next.event, origin: next.origin, input: event, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error), context });
      throw error;
    }
  });
}

/** Replay is intended for pure/mock adapters. It deliberately refuses recorded failures. */
export async function replayAndVerify(runtime: ReplayRuntimePort, record: ReplayRecord): Promise<unknown> {
  if (record.error) throw new ReplayMismatchError(`Recorded dispatch ${record.sequence} failed originally; automatic replay is disabled.`);
  const result = await runtime.dispatch(record.event, record.input, record.origin);
  if (canonicalJson(result) !== canonicalJson(record.result)) {
    throw new ReplayMismatchError(`Replay mismatch for record ${record.sequence} (${record.event}).`);
  }
  return result;
}


/** Stable-kernel recorder for explicit events. */
export function registerReplayHooks<M extends import("@function-hooks/core").EventMap>(
  builder: import("@function-hooks/core").KernelBuilder<M>, pluginOrder: number, events: readonly import("@function-hooks/core").EventName<M>[], log: ReplayLog, context: ReplayContext = {},
): void {
  for (const event of events) builder.on("replay-recorder", pluginOrder, event, async (_engine, input, next) => {
    const at = Date.now();
    try {
      const result = await next(input as never);
      log.append({ at, event: String(next.event), origin: next.origin, input, ...(result === undefined ? {} : { result }), context });
      return result;
    } catch (error) {
      log.append({ at, event: String(next.event), origin: next.origin, input, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error), context });
      throw error;
    }
  });
}

export async function replayKernelRecord<M extends import("@function-hooks/core").EventMap>(runtime: import("@function-hooks/core").Runtime<M>, record: ReplayRecord): Promise<unknown> {
  if (record.error) throw new ReplayMismatchError(`Recorded dispatch ${record.sequence} failed originally; automatic replay is disabled.`);
  const result = await runtime.dispatch(record.event as import("@function-hooks/core").EventName<M>, record.input as never, { origin: record.origin });
  if (canonicalJson(result) !== canonicalJson(record.result)) throw new ReplayMismatchError(`Replay mismatch for record ${record.sequence} (${record.event}).`);
  return result;
}
