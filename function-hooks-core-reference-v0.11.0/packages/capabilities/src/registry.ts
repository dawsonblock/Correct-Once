import { CapabilityNotFoundError, CapabilityRegistryConflictError, CapabilityStateError } from "./errors.js";
import { capabilitySnapshot } from "./canonical.js";
import { assertAdmittedCapability } from "./capability.js";
import type { AdmittedCapability, CapabilityRegistry, CapabilityRegistryFilter, CapabilityRegistryRecord, CapabilityRegistrySnapshot, CapabilityRegistryState } from "./types.js";

function now(): string { return new Date().toISOString(); }
function cloneRecord(record: CapabilityRegistryRecord): CapabilityRegistryRecord { return capabilitySnapshot(record); }

export class InMemoryCapabilityRegistry implements CapabilityRegistry {
  readonly #records = new Map<string, CapabilityRegistryRecord>();
  async register(capability: AdmittedCapability): Promise<CapabilityRegistryRecord> {
    assertAdmittedCapability(capability);
    const existing = this.#records.get(capability.id);
    if (existing) {
      if (existing.capability.candidateHash === capability.candidateHash && existing.capability.admission.admissionId === capability.admission.admissionId) return cloneRecord(existing);
      throw new CapabilityRegistryConflictError(`Capability ${capability.id} is already registered with different admission evidence.`);
    }
    const record = capabilitySnapshot({ capability, state: "active" as const, stateVersion: 1, updatedAt: now() });
    this.#records.set(capability.id, record);
    return cloneRecord(record);
  }
  async get(id: string): Promise<CapabilityRegistryRecord | undefined> { const record=this.#records.get(id); return record ? cloneRecord(record) : undefined; }
  async list(filter: CapabilityRegistryFilter = {}): Promise<readonly CapabilityRegistryRecord[]> {
    return Object.freeze([...this.#records.values()].filter((record) =>
      (filter.state === undefined || record.state === filter.state) &&
      (filter.app === undefined || record.capability.app === filter.app) &&
      (filter.capability === undefined || record.capability.capability === filter.capability)
    ).sort((a,b)=>a.capability.id.localeCompare(b.capability.id)).map(cloneRecord));
  }
  async activate(id: string, reason?: string): Promise<CapabilityRegistryRecord> { return this.#transition(id,"active",reason); }
  async suspend(id: string, reason?: string): Promise<CapabilityRegistryRecord> { return this.#transition(id,"suspended",reason); }
  async revoke(id: string, reason?: string): Promise<CapabilityRegistryRecord> { return this.#transition(id,"revoked",reason); }
  async supersede(id: string, reason?: string): Promise<CapabilityRegistryRecord> { return this.#transition(id,"superseded",reason); }
  async snapshot(): Promise<CapabilityRegistrySnapshot> { return capabilitySnapshot({ format:"function-hooks.capability-registry.v1" as const, records: await this.list() }); }
  async #transition(id: string, state: CapabilityRegistryState, reason?: string): Promise<CapabilityRegistryRecord> {
    const existing=this.#records.get(id); if(!existing) throw new CapabilityNotFoundError(`Capability ${id} is not registered.`);
    if ((existing.state === "revoked" || existing.state === "superseded") && state !== existing.state) throw new CapabilityStateError(`Capability ${id} is terminal in state ${existing.state}.`);
    if (existing.state === state && reason === existing.reason) return cloneRecord(existing);
    const next=capabilitySnapshot({ capability: existing.capability, state, stateVersion: existing.stateVersion + 1, updatedAt: now(), ...(reason === undefined ? {} : {reason}) });
    this.#records.set(id,next); return cloneRecord(next);
  }
}
