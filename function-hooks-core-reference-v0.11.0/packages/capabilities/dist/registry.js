import { CapabilityNotFoundError, CapabilityRegistryConflictError, CapabilityStateError } from "./errors.js";
import { capabilitySnapshot } from "./canonical.js";
import { assertAdmittedCapability } from "./capability.js";
function now() { return new Date().toISOString(); }
function cloneRecord(record) { return capabilitySnapshot(record); }
export class InMemoryCapabilityRegistry {
    #records = new Map();
    async register(capability) {
        assertAdmittedCapability(capability);
        const existing = this.#records.get(capability.id);
        if (existing) {
            if (existing.capability.candidateHash === capability.candidateHash && existing.capability.admission.admissionId === capability.admission.admissionId)
                return cloneRecord(existing);
            throw new CapabilityRegistryConflictError(`Capability ${capability.id} is already registered with different admission evidence.`);
        }
        const record = capabilitySnapshot({ capability, state: "active", stateVersion: 1, updatedAt: now() });
        this.#records.set(capability.id, record);
        return cloneRecord(record);
    }
    async get(id) { const record = this.#records.get(id); return record ? cloneRecord(record) : undefined; }
    async list(filter = {}) {
        return Object.freeze([...this.#records.values()].filter((record) => (filter.state === undefined || record.state === filter.state) &&
            (filter.app === undefined || record.capability.app === filter.app) &&
            (filter.capability === undefined || record.capability.capability === filter.capability)).sort((a, b) => a.capability.id.localeCompare(b.capability.id)).map(cloneRecord));
    }
    async activate(id, reason) { return this.#transition(id, "active", reason); }
    async suspend(id, reason) { return this.#transition(id, "suspended", reason); }
    async revoke(id, reason) { return this.#transition(id, "revoked", reason); }
    async supersede(id, reason) { return this.#transition(id, "superseded", reason); }
    async snapshot() { return capabilitySnapshot({ format: "function-hooks.capability-registry.v1", records: await this.list() }); }
    async #transition(id, state, reason) {
        const existing = this.#records.get(id);
        if (!existing)
            throw new CapabilityNotFoundError(`Capability ${id} is not registered.`);
        if ((existing.state === "revoked" || existing.state === "superseded") && state !== existing.state)
            throw new CapabilityStateError(`Capability ${id} is terminal in state ${existing.state}.`);
        if (existing.state === state && reason === existing.reason)
            return cloneRecord(existing);
        const next = capabilitySnapshot({ capability: existing.capability, state, stateVersion: existing.stateVersion + 1, updatedAt: now(), ...(reason === undefined ? {} : { reason }) });
        this.#records.set(id, next);
        return cloneRecord(next);
    }
}
//# sourceMappingURL=registry.js.map