import { open, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { canonicalJson, sha256Hex } from "@function-hooks/assurance";
import { GenerationActivationError } from "./errors.js";
export type EngineObject = Readonly<Record<string, Readonly<Record<string, (input: unknown) => Promise<unknown>>>>>;
export interface StartableRuntime { start(): Promise<EngineObject>; close?(): void | Promise<void>; }

export interface RuntimeGeneration {
  readonly id: string;
  readonly runtime: StartableRuntime;
  readonly engine: EngineObject;
  readonly createdAt: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly close?: () => void | Promise<void>;
}

export interface GenerationLease {
  readonly generation: RuntimeGeneration;
  release(): Promise<void>;
}

export interface ActivationReceipt {
  readonly activationId: string;
  readonly at: number;
  readonly fromGeneration?: string;
  readonly toGeneration: string;
  readonly metadataHash: string;
  readonly healthChecks: readonly string[];
}

export interface ActivationReceiptSink {
  append(receipt: ActivationReceipt): void | Promise<void>;
}

export class FileActivationReceiptSink implements ActivationReceiptSink {
  readonly #path: string;
  readonly #sync: boolean;
  #queue: Promise<void> = Promise.resolve();

  constructor(path: string, options: { readonly sync?: boolean } = {}) {
    this.#path = path;
    this.#sync = options.sync ?? true;
  }

  async append(receipt: ActivationReceipt): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const line = `${JSON.stringify(receipt)}\n`;
    const task = this.#queue.then(async () => {
      const handle = await open(this.#path, "a");
      try {
        await handle.write(line);
        if (this.#sync) await handle.sync();
      } finally { await handle.close(); }
    });
    this.#queue = task.catch(() => {});
    await task;
  }
}

interface ManagedGeneration {
  readonly generation: RuntimeGeneration;
  leases: number;
  draining: boolean;
  closeStarted: boolean;
}

export class RuntimeGenerationManager {
  readonly #receiptSink: ActivationReceiptSink | undefined;
  readonly #managed = new Map<string, ManagedGeneration>();
  #active: ManagedGeneration | undefined;

  constructor(options: { readonly receiptSink?: ActivationReceiptSink } = {}) {
    this.#receiptSink = options.receiptSink;
  }

  current(): RuntimeGeneration | undefined { return this.#active?.generation; }

  async activate(
    build: () => Promise<Omit<RuntimeGeneration, "id" | "createdAt" | "engine"> & { readonly id?: string; readonly engine?: EngineObject }>,
    healthChecks: Readonly<Record<string, (generation: RuntimeGeneration) => boolean | Promise<boolean>>> = {},
  ): Promise<ActivationReceipt> {
    const built = await build();
    const engine = built.engine ?? await built.runtime.start();
    const generation: RuntimeGeneration = Object.freeze({
      id: built.id ?? randomUUID(),
      runtime: built.runtime,
      engine,
      createdAt: Date.now(),
      ...(built.metadata ? { metadata: Object.freeze({ ...built.metadata }) } : {}),
      ...(built.close ? { close: built.close } : {}),
    });

    const passed: string[] = [];
    try {
      for (const [name, check] of Object.entries(healthChecks)) {
        if (!(await check(generation))) throw new GenerationActivationError(`Health check failed: ${name}`);
        passed.push(name);
      }
    } catch (error) {
      await generation.close?.();
      throw error;
    }

    const previous = this.#active;
    const managed: ManagedGeneration = { generation, leases: 0, draining: false, closeStarted: false };
    this.#managed.set(generation.id, managed);
    this.#active = managed; // atomic publication in the JS event loop
    if (previous) {
      previous.draining = true;
      void this.#tryClose(previous);
    }

    const metadataHash = sha256Hex(canonicalJson(generation.metadata ?? {}));
    const receipt: ActivationReceipt = Object.freeze({
      activationId: randomUUID(),
      at: Date.now(),
      ...(previous ? { fromGeneration: previous.generation.id } : {}),
      toGeneration: generation.id,
      metadataHash,
      healthChecks: Object.freeze(passed),
    });
    await this.#receiptSink?.append(receipt);
    return receipt;
  }

  acquire(): GenerationLease {
    const managed = this.#active;
    if (!managed) throw new GenerationActivationError("No active runtime generation.");
    managed.leases += 1;
    let released = false;
    return Object.freeze({
      generation: managed.generation,
      release: async () => {
        if (released) return;
        released = true;
        managed.leases -= 1;
        await this.#tryClose(managed);
      },
    });
  }

  async close(): Promise<void> {
    for (const managed of this.#managed.values()) managed.draining = true;
    await Promise.all([...this.#managed.values()].map((managed) => this.#tryClose(managed)));
  }

  async #tryClose(managed: ManagedGeneration): Promise<void> {
    if (!managed.draining || managed.leases > 0 || managed.closeStarted) return;
    managed.closeStarted = true;
    try { await managed.generation.close?.(); }
    finally { this.#managed.delete(managed.generation.id); }
  }
}
