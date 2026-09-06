import { open, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { canonicalJson, sha256Hex } from "@function-hooks/assurance";
import { GenerationActivationError } from "./errors.js";
export class FileActivationReceiptSink {
    #path;
    #sync;
    #queue = Promise.resolve();
    constructor(path, options = {}) {
        this.#path = path;
        this.#sync = options.sync ?? true;
    }
    async append(receipt) {
        await mkdir(dirname(this.#path), { recursive: true });
        const line = `${JSON.stringify(receipt)}\n`;
        const task = this.#queue.then(async () => {
            const handle = await open(this.#path, "a");
            try {
                await handle.write(line);
                if (this.#sync)
                    await handle.sync();
            }
            finally {
                await handle.close();
            }
        });
        this.#queue = task.catch(() => { });
        await task;
    }
}
export class RuntimeGenerationManager {
    #receiptSink;
    #managed = new Map();
    #active;
    constructor(options = {}) {
        this.#receiptSink = options.receiptSink;
    }
    current() { return this.#active?.generation; }
    async activate(build, healthChecks = {}) {
        const built = await build();
        const engine = built.engine ?? await built.runtime.start();
        const generation = Object.freeze({
            id: built.id ?? randomUUID(),
            runtime: built.runtime,
            engine,
            createdAt: Date.now(),
            ...(built.metadata ? { metadata: Object.freeze({ ...built.metadata }) } : {}),
            ...(built.close ? { close: built.close } : {}),
        });
        const passed = [];
        try {
            for (const [name, check] of Object.entries(healthChecks)) {
                if (!(await check(generation)))
                    throw new GenerationActivationError(`Health check failed: ${name}`);
                passed.push(name);
            }
        }
        catch (error) {
            await generation.close?.();
            throw error;
        }
        const previous = this.#active;
        const managed = { generation, leases: 0, draining: false, closeStarted: false };
        this.#managed.set(generation.id, managed);
        this.#active = managed; // atomic publication in the JS event loop
        if (previous) {
            previous.draining = true;
            void this.#tryClose(previous);
        }
        const metadataHash = sha256Hex(canonicalJson(generation.metadata ?? {}));
        const receipt = Object.freeze({
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
    acquire() {
        const managed = this.#active;
        if (!managed)
            throw new GenerationActivationError("No active runtime generation.");
        managed.leases += 1;
        let released = false;
        return Object.freeze({
            generation: managed.generation,
            release: async () => {
                if (released)
                    return;
                released = true;
                managed.leases -= 1;
                await this.#tryClose(managed);
            },
        });
    }
    async close() {
        for (const managed of this.#managed.values())
            managed.draining = true;
        await Promise.all([...this.#managed.values()].map((managed) => this.#tryClose(managed)));
    }
    async #tryClose(managed) {
        if (!managed.draining || managed.leases > 0 || managed.closeStarted)
            return;
        managed.closeStarted = true;
        try {
            await managed.generation.close?.();
        }
        finally {
            this.#managed.delete(managed.generation.id);
        }
    }
}
//# sourceMappingURL=lifecycle.js.map