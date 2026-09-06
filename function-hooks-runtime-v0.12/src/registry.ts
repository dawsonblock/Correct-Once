import { capabilitySnapshot } from "@function-hooks/capabilities";
import { assertRuntimeAdmittedCapability } from "./admission.js";
import {
  RuntimeCapabilityNotFoundError,
  RuntimeCapabilityStateError,
  RuntimeExecutionPolicyError,
} from "./errors.js";
import type {
  RuntimeAdmittedCapability,
  RuntimeCapabilityCatalogEntry,
  RuntimeCapabilityRegistry,
  RuntimeCapabilityRegistryFilter,
  RuntimeCapabilityRegistryRecord,
  RuntimeCapabilityRegistrySnapshot,
  RuntimeRegistryChange,
  RuntimeRegistryListener,
} from "./types.js";

function now(): string {
  return new Date().toISOString();
}

function cloneRecord(record: RuntimeCapabilityRegistryRecord): RuntimeCapabilityRegistryRecord {
  return capabilitySnapshot(record);
}

function sameRuntimeCapability(
  left: RuntimeAdmittedCapability,
  right: RuntimeAdmittedCapability,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class InMemoryRuntimeCapabilityRegistry implements RuntimeCapabilityRegistry {
  readonly #records = new Map<string, RuntimeCapabilityRegistryRecord>();
  readonly #listeners = new Set<RuntimeRegistryListener>();

  async register(capability: RuntimeAdmittedCapability): Promise<RuntimeCapabilityRegistryRecord> {
    assertRuntimeAdmittedCapability(capability);
    const existing = this.#records.get(capability.capability.id);
    if (existing) {
      if (sameRuntimeCapability(existing.capability, capability)) return cloneRecord(existing);
      throw new RuntimeExecutionPolicyError(
        `Capability ${capability.capability.id} is already registered with different admission or execution evidence.`,
      );
    }
    const record = capabilitySnapshot({
      capability,
      state: "active" as const,
      stateVersion: 1,
      updatedAt: now(),
    });
    this.#records.set(capability.capability.id, record);
    this.#emit({
      id: capability.capability.id,
      state: record.state,
      stateVersion: record.stateVersion,
    });
    return cloneRecord(record);
  }

  async get(id: string): Promise<RuntimeCapabilityRegistryRecord | undefined> {
    const record = this.#records.get(id);
    return record ? cloneRecord(record) : undefined;
  }

  async list(
    filter: RuntimeCapabilityRegistryFilter = {},
  ): Promise<readonly RuntimeCapabilityRegistryRecord[]> {
    return Object.freeze(
      [...this.#records.values()]
        .filter((record) =>
          (filter.state === undefined || record.state === filter.state) &&
          (filter.app === undefined || record.capability.capability.app === filter.app) &&
          (filter.capability === undefined ||
            record.capability.capability.capability === filter.capability) &&
          (filter.executionClass === undefined ||
            record.capability.execution.executionClass === filter.executionClass),
        )
        .sort((left, right) =>
          left.capability.capability.id.localeCompare(right.capability.capability.id),
        )
        .map(cloneRecord),
    );
  }

  async activate(id: string, reason?: string): Promise<RuntimeCapabilityRegistryRecord> {
    return this.#transition(id, "active", reason);
  }

  async suspend(id: string, reason?: string): Promise<RuntimeCapabilityRegistryRecord> {
    return this.#transition(id, "suspended", reason);
  }

  async revoke(id: string, reason?: string): Promise<RuntimeCapabilityRegistryRecord> {
    return this.#transition(id, "revoked", reason);
  }

  async supersede(id: string, reason?: string): Promise<RuntimeCapabilityRegistryRecord> {
    return this.#transition(id, "superseded", reason);
  }

  async snapshot(): Promise<RuntimeCapabilityRegistrySnapshot> {
    return capabilitySnapshot({
      format: "function-hooks.runtime-capability-registry.v0.12" as const,
      records: await this.list(),
    });
  }

  subscribe(listener: RuntimeRegistryListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async #transition(
    id: string,
    state: RuntimeCapabilityRegistryRecord["state"],
    reason?: string,
  ): Promise<RuntimeCapabilityRegistryRecord> {
    const existing = this.#records.get(id);
    if (!existing) {
      throw new RuntimeCapabilityNotFoundError(`Capability ${id} is not registered.`);
    }
    if (
      (existing.state === "revoked" || existing.state === "superseded") &&
      state !== existing.state
    ) {
      throw new RuntimeCapabilityStateError(
        `Capability ${id} is terminal in state ${existing.state}.`,
      );
    }
    if (existing.state === state && reason === existing.reason) return cloneRecord(existing);
    const next = capabilitySnapshot({
      capability: existing.capability,
      state,
      stateVersion: existing.stateVersion + 1,
      updatedAt: now(),
      ...(reason === undefined ? {} : { reason }),
    });
    this.#records.set(id, next);
    this.#emit({ id, state: next.state, stateVersion: next.stateVersion });
    return cloneRecord(next);
  }

  #emit(change: RuntimeRegistryChange): void {
    for (const listener of this.#listeners) listener(change);
  }
}

export async function projectRuntimeCapabilityCatalog(
  registry: RuntimeCapabilityRegistry,
  filter: RuntimeCapabilityRegistryFilter = {},
): Promise<readonly RuntimeCapabilityCatalogEntry[]> {
  const records = await registry.list({ ...filter, state: filter.state ?? "active" });
  return Object.freeze(
    records.map(({ capability }) =>
      capabilitySnapshot({
        id: capability.capability.id,
        app: capability.capability.app,
        capability: capability.capability.capability,
        description: capability.capability.description,
        inputSchema: capability.capability.inputSchema,
        ...(capability.capability.outputSchema === undefined
          ? {}
          : { outputSchema: capability.capability.outputSchema }),
        sideEffect: capability.capability.sideEffect,
        sensitivity: capability.capability.sensitivity,
        risk: capability.capability.risk,
        schemaHash: capability.capability.schemaHash,
        executionClass: capability.execution.executionClass,
        ...(capability.execution.policyHookId
          ? { policyHookId: capability.execution.policyHookId }
          : {}),
        requiresLightweightAuth: capability.execution.requiresLightweightAuth,
        trustedRead: capability.execution.trustedRead,
      }),
    ),
  );
}
