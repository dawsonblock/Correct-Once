import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { canonicalJson, sha256Hex } from "./canonical.js";
import { ActionReceiptConflictError, IndeterminateActionError } from "./errors.js";
import { withFileLock } from "./file-lock.js";

export interface ReceiptNext {
  (event: unknown): Promise<unknown>;
  readonly event: string;
  readonly origin: string;
  readonly signal: AbortSignal;
}
export interface ReceiptRegistrar {
  (event: string, callback: (engine: unknown, event: unknown, next: ReceiptNext) => unknown | Promise<unknown>): void;
  (event: string, matcher: unknown, callback: (engine: unknown, event: unknown, next: ReceiptNext) => unknown | Promise<unknown>): void;
}
export interface ReceiptRuntimePort { registrar(plugin: string, order: number): ReceiptRegistrar; }

export type ActionReceiptState = "started" | "completed" | "indeterminate";

export interface ActionReceipt {
  readonly actionId: string;
  readonly event: string;
  readonly inputHash: string;
  readonly state: ActionReceiptState;
  readonly startedAt: number;
  readonly completedAt?: number;
  readonly result?: unknown;
  readonly resultHash?: string;
  readonly error?: string;
}

export interface ActionReceiptStore {
  get(actionId: string): Promise<ActionReceipt | undefined>;
  begin(actionId: string, event: string, input: unknown): Promise<{ readonly created: true; readonly receipt: ActionReceipt } | { readonly created: false; readonly receipt: ActionReceipt }>;
  complete(actionId: string, result: unknown): Promise<ActionReceipt>;
  markIndeterminate(actionId: string, error?: string): Promise<ActionReceipt>;
}

function makeStarted(actionId: string, event: string, input: unknown): ActionReceipt {
  return Object.freeze({ actionId, event, inputHash: sha256Hex(canonicalJson(input)), state: "started" as const, startedAt: Date.now() });
}

function checkClaim(existing: ActionReceipt, event: string, input: unknown): void {
  const inputHash = sha256Hex(canonicalJson(input));
  if (existing.event !== event || existing.inputHash !== inputHash) {
    throw new ActionReceiptConflictError(`Action ID ${existing.actionId} was reused with a different event or input.`);
  }
}

const UNDEFINED_RESULT_HASH = sha256Hex("function-hooks/action-receipt/result/undefined/v1");

function resultHash(result: unknown): string {
  return result === undefined ? UNDEFINED_RESULT_HASH : sha256Hex(canonicalJson(result));
}

function deepFreezeValue<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const key of Reflect.ownKeys(object)) deepFreezeValue((object as Record<PropertyKey, unknown>)[key], seen);
  return Object.freeze(value);
}

/**
 * Receipt replay must not retain a mutable reference owned by the adapter caller.
 * Canonical JSON also normalizes the persisted representation so in-memory replay
 * and file-backed replay have the same value semantics. Top-level undefined is a
 * valid void result and is represented by omission plus a domain-separated hash.
 */
function snapshotResult(result: unknown): unknown {
  if (result === undefined) return undefined;
  const normalized = JSON.parse(canonicalJson(result)) as unknown;
  return deepFreezeValue(normalized);
}

function validateReceiptShape(receipt: ActionReceipt, index: number): void {
  const where = `Action receipt record ${index}`;
  if (typeof receipt.actionId !== "string" || receipt.actionId.length === 0) throw new Error(`${where} has an invalid actionId.`);
  if (typeof receipt.event !== "string" || receipt.event.length === 0) throw new Error(`${where} has an invalid event.`);
  if (!/^[a-f0-9]{64}$/.test(receipt.inputHash)) throw new Error(`${where} has an invalid inputHash.`);
  if (!Number.isFinite(receipt.startedAt)) throw new Error(`${where} has an invalid startedAt.`);
  if (receipt.state !== "started" && receipt.state !== "completed" && receipt.state !== "indeterminate") throw new Error(`${where} has an invalid state.`);
  if (receipt.state === "completed") {
    if (!Number.isFinite(receipt.completedAt)) throw new Error(`${where} has an invalid completedAt.`);
    if (typeof receipt.resultHash !== "string" || !/^[a-f0-9]{64}$/.test(receipt.resultHash)) throw new Error(`${where} has an invalid resultHash.`);
    if (resultHash(receipt.result) !== receipt.resultHash) throw new Error(`${where} resultHash does not match its persisted result.`);
  } else if (receipt.completedAt !== undefined || receipt.resultHash !== undefined || receipt.result !== undefined) {
    throw new Error(`${where} contains completion fields before completion.`);
  }
}

function validateTransition(previous: ActionReceipt | undefined, receipt: ActionReceipt, index: number): void {
  const where = `Action receipt record ${index}`;
  if (!previous) {
    if (receipt.state !== "started") throw new Error(`${where} must begin an action with the started state.`);
    return;
  }
  if (previous.event !== receipt.event || previous.inputHash !== receipt.inputHash || previous.startedAt !== receipt.startedAt) {
    throw new Error(`${where} changes immutable receipt identity fields.`);
  }
  if (previous.state === "started" && (receipt.state === "completed" || receipt.state === "indeterminate")) return;
  if (previous.state === "indeterminate" && receipt.state === "indeterminate") return;
  throw new Error(`${where} contains an invalid ${previous.state} -> ${receipt.state} transition.`);
}

export class InMemoryActionReceiptStore implements ActionReceiptStore {
  readonly #receipts = new Map<string, ActionReceipt>();

  async get(actionId: string): Promise<ActionReceipt | undefined> { return this.#receipts.get(actionId); }

  async begin(actionId: string, event: string, input: unknown): Promise<{ readonly created: true; readonly receipt: ActionReceipt } | { readonly created: false; readonly receipt: ActionReceipt }> {
    const existing = this.#receipts.get(actionId);
    if (existing) {
      checkClaim(existing, event, input);
      return { created: false, receipt: existing };
    }
    const receipt = makeStarted(actionId, event, input);
    this.#receipts.set(actionId, receipt);
    return { created: true, receipt };
  }

  async complete(actionId: string, result: unknown): Promise<ActionReceipt> {
    const prior = this.#receipts.get(actionId);
    if (!prior) throw new ActionReceiptConflictError(`Cannot complete unknown action ${actionId}.`);
    if (prior.state === "completed") return prior;
    if (prior.state !== "started") throw new IndeterminateActionError(`Action ${actionId} is ${prior.state}; operator resolution is required.`);
    const storedResult = snapshotResult(result);
    const receipt = Object.freeze({ ...prior, state: "completed" as const, completedAt: Date.now(), ...(storedResult === undefined ? {} : { result: storedResult }), resultHash: resultHash(storedResult) });
    this.#receipts.set(actionId, receipt);
    return receipt;
  }

  async markIndeterminate(actionId: string, error?: string): Promise<ActionReceipt> {
    const prior = this.#receipts.get(actionId);
    if (!prior) throw new ActionReceiptConflictError(`Cannot mark unknown action ${actionId}.`);
    if (prior.state === "completed") return prior;
    const receipt = Object.freeze({ ...prior, state: "indeterminate" as const, ...(error ? { error } : {}) });
    this.#receipts.set(actionId, receipt);
    return receipt;
  }
}

interface ReceiptTransition {
  readonly actionId: string;
  readonly receipt: ActionReceipt;
}

export interface FileActionReceiptStoreOptions {
  readonly sync?: "always" | "none";
  readonly recoverTrailingPartial?: boolean;
  /** Cross-process coordination using a crash-recoverable exclusive lock file. Defaults to true. */
  readonly crossProcessLock?: boolean;
  readonly lockTimeoutMs?: number;
  readonly lockStaleMs?: number;
}

export class FileActionReceiptStore implements ActionReceiptStore {
  readonly #path: string;
  readonly #options: FileActionReceiptStoreOptions;
  readonly #receipts = new Map<string, ActionReceipt>();
  #transitionQueue: Promise<void> = Promise.resolve();
  #persistenceFailure: Error | undefined;

  private constructor(path: string, options: FileActionReceiptStoreOptions) {
    this.#path = path;
    this.#options = options;
  }

  static async open(path: string, options: FileActionReceiptStoreOptions = {}): Promise<FileActionReceiptStore> {
    await mkdir(dirname(path), { recursive: true });
    const store = new FileActionReceiptStore(path, options);
    await withFileLock(path, { enabled: options.crossProcessLock ?? true, ...(options.lockTimeoutMs === undefined ? {} : { timeoutMs: options.lockTimeoutMs }), ...(options.lockStaleMs === undefined ? {} : { staleMs: options.lockStaleMs }) }, async () => {
      try { await readFile(path, "utf8"); }
      catch (error: any) {
        if (error?.code !== "ENOENT") throw error;
        await writeFile(path, "", "utf8");
      }
      await store.#reloadFromDisk(options.recoverTrailingPartial ?? false);
    });
    return store;
  }

  async #reloadFromDisk(recoverTrailingPartial: boolean): Promise<void> {
    let raw = await readFile(this.#path, "utf8") as string;
    if (raw && !raw.endsWith("\n")) {
      if (!recoverTrailingPartial) throw new Error("Action receipt journal ends with an unterminated record.");
      const last = raw.lastIndexOf("\n");
      raw = last < 0 ? "" : raw.slice(0, last + 1);
      await writeFile(this.#path, raw, "utf8");
    }
    const loaded = new Map<string, ActionReceipt>();
    for (const [index, line] of raw.split("\n").entries()) {
      if (!line.trim()) continue;
      let transition: ReceiptTransition;
      try { transition = JSON.parse(line) as ReceiptTransition; }
      catch (error) { throw new Error(`Action receipt record ${index} is invalid JSON.`, { cause: error }); }
      if (!transition?.receipt || transition.actionId !== transition.receipt.actionId) throw new Error(`Malformed action receipt record ${index}.`);
      validateReceiptShape(transition.receipt, index);
      const previous = loaded.get(transition.actionId);
      validateTransition(previous, transition.receipt, index);
      const storedResult = transition.receipt.state === "completed" ? snapshotResult(transition.receipt.result) : undefined;
      const normalized = Object.freeze({ ...transition.receipt, ...(storedResult === undefined ? {} : { result: storedResult }) });
      loaded.set(transition.actionId, normalized);
    }
    this.#receipts.clear();
    for (const [actionId, receipt] of loaded) this.#receipts.set(actionId, receipt);
  }

  async #transaction<T>(operation: () => Promise<T>): Promise<T> {
    const guarded = async (): Promise<T> => {
      if (this.#persistenceFailure) throw new ActionReceiptConflictError("Action receipt store is unavailable after a persistence failure; reopen and recover before continuing.", { cause: this.#persistenceFailure });
      return withFileLock(this.#path, {
        enabled: this.#options.crossProcessLock ?? true,
        ...(this.#options.lockTimeoutMs === undefined ? {} : { timeoutMs: this.#options.lockTimeoutMs }),
        ...(this.#options.lockStaleMs === undefined ? {} : { staleMs: this.#options.lockStaleMs }),
      }, async () => {
        await this.#reloadFromDisk(this.#options.recoverTrailingPartial ?? false);
        return operation();
      });
    };
    const run = this.#transitionQueue.then(guarded, guarded);
    this.#transitionQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  async get(actionId: string): Promise<ActionReceipt | undefined> {
    return this.#transaction(async () => this.#receipts.get(actionId));
  }

  async begin(actionId: string, event: string, input: unknown): Promise<{ readonly created: true; readonly receipt: ActionReceipt } | { readonly created: false; readonly receipt: ActionReceipt }> {
    return this.#transaction(async () => {
      const existing = this.#receipts.get(actionId);
      if (existing) {
        checkClaim(existing, event, input);
        return { created: false as const, receipt: existing };
      }
      const receipt = makeStarted(actionId, event, input);
      await this.#append(receipt);
      this.#receipts.set(actionId, receipt);
      return { created: true as const, receipt };
    });
  }

  async complete(actionId: string, result: unknown): Promise<ActionReceipt> {
    return this.#transaction(async () => {
      const prior = this.#receipts.get(actionId);
      if (!prior) throw new ActionReceiptConflictError(`Cannot complete unknown action ${actionId}.`);
      if (prior.state === "completed") return prior;
      if (prior.state !== "started") throw new IndeterminateActionError(`Action ${actionId} is ${prior.state}; operator resolution is required.`);
      const storedResult = snapshotResult(result);
      const receipt = Object.freeze({ ...prior, state: "completed" as const, completedAt: Date.now(), ...(storedResult === undefined ? {} : { result: storedResult }), resultHash: resultHash(storedResult) });
      await this.#append(receipt);
      this.#receipts.set(actionId, receipt);
      return receipt;
    });
  }

  async markIndeterminate(actionId: string, error?: string): Promise<ActionReceipt> {
    return this.#transaction(async () => {
      const prior = this.#receipts.get(actionId);
      if (!prior) throw new ActionReceiptConflictError(`Cannot mark unknown action ${actionId}.`);
      if (prior.state === "completed") return prior;
      const receipt = Object.freeze({ ...prior, state: "indeterminate" as const, ...(error ? { error } : {}) });
      await this.#append(receipt);
      this.#receipts.set(actionId, receipt);
      return receipt;
    });
  }

  async #append(receipt: ActionReceipt): Promise<void> {
    const line = `${JSON.stringify({ actionId: receipt.actionId, receipt } satisfies ReceiptTransition)}\n`;
    try {
      const handle = await open(this.#path, "a");
      try {
        await handle.write(line);
        if ((this.#options.sync ?? "always") === "always") await handle.sync();
      } finally { await handle.close(); }
    } catch (error) {
      this.#persistenceFailure = error instanceof Error ? error : new Error(String(error));
      throw error;
    }
  }
}
export interface ActionReceiptPluginOptions {
  readonly events: ReadonlySet<string>;
  readonly actionId?: (event: string, input: unknown) => string | undefined;
}

function defaultActionId(_event: string, input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = (input as Record<string, unknown>).actionId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Adds retry-safe exactly-once-or-detect semantics to selected side-effect events.
 * Completed receipts are replayed without re-executing the lower chain. A failure
 * after durable begin but before durable completion becomes indeterminate and fails closed.
 */
export function registerActionReceiptPlugin(
  runtime: ReceiptRuntimePort,
  pluginOrder: number,
  store: ActionReceiptStore,
  options: ActionReceiptPluginOptions,
): void {
  const extract = options.actionId ?? defaultActionId;
  const on = runtime.registrar("enterprise-action-receipts", pluginOrder);
  on("*", async (_$, event, next) => {
    if (!options.events.has(next.event)) return next(event);
    const actionId = extract(next.event, event);
    if (!actionId) throw new ActionReceiptConflictError(`Event ${next.event} requires a non-empty actionId.`);
    const claim = await store.begin(actionId, next.event, event);
    if (!claim.created) {
      if (claim.receipt.state === "completed") return claim.receipt.result;
      throw new IndeterminateActionError(`Action ${actionId} is ${claim.receipt.state}; refusing automatic re-execution.`);
    }
    try {
      const result = await next(event);
      await store.complete(actionId, result);
      return result;
    } catch (error) {
      await store.markIndeterminate(actionId, error instanceof Error ? error.message : String(error));
      throw error;
    }
  });
}


/** Stable-kernel adapter: registers receipt protection on explicit event names. */
export function registerActionReceiptHooks<M extends import("@function-hooks/core").EventMap>(
  builder: import("@function-hooks/core").KernelBuilder<M>,
  pluginOrder: number,
  store: ActionReceiptStore,
  options: ActionReceiptPluginOptions,
): void {
  const extract = options.actionId ?? defaultActionId;
  for (const event of options.events) {
    builder.on("enterprise-action-receipts", pluginOrder, event as import("@function-hooks/core").EventName<M>, async (_engine, input, next) => {
      const actionId = extract(String(next.event), input);
      if (!actionId) throw new ActionReceiptConflictError(`Event ${String(next.event)} requires a non-empty actionId.`);
      const claim = await store.begin(actionId, String(next.event), input);
      if (!claim.created) {
        if (claim.receipt.state === "completed") return claim.receipt.result as never;
        throw new IndeterminateActionError(`Action ${actionId} is ${claim.receipt.state}; refusing automatic re-execution.`);
      }
      try {
        const result = await next(input as never);
        await store.complete(actionId, result);
        return result;
      } catch (error) {
        await store.markIndeterminate(actionId, error instanceof Error ? error.message : String(error));
        throw error;
      }
    });
  }
}
