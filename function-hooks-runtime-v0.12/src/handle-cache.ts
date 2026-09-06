import type { CompiledCapabilityHandle } from "./types.js";

export class CapabilityHandleCache {
  readonly #handles = new Map<string, CompiledCapabilityHandle>();

  get(id: string): CompiledCapabilityHandle | undefined {
    return this.#handles.get(id);
  }

  set(handle: CompiledCapabilityHandle): CompiledCapabilityHandle {
    this.#handles.set(handle.id, handle);
    return handle;
  }

  delete(id: string): void {
    this.#handles.delete(id);
  }

  clear(): void {
    this.#handles.clear();
  }

  get size(): number {
    return this.#handles.size;
  }
}
