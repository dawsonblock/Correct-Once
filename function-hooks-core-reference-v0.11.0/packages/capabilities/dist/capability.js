import { CapabilityAdmissionError, InvalidCapabilityError } from "./errors.js";
import { capabilitySha256, capabilitySnapshot } from "./canonical.js";
const SIDES = new Set(["read", "write", "external", "destructive", "unknown"]);
const SENSITIVITIES = new Set(["public", "private", "secret", "unknown"]);
const RISKS = new Set(["low", "medium", "high", "critical"]);
const IMPLEMENTATIONS = new Set(["mcp", "http", "browser", "desktop", "process", "filesystem.read", "filesystem.write"]);
function nonEmpty(value, field) {
    if (typeof value !== "string" || value.trim().length === 0)
        throw new InvalidCapabilityError(`${field} must be a non-empty string.`);
    return value;
}
function iso(value, field) {
    const out = value ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(out)))
        throw new InvalidCapabilityError(`${field} must be an ISO-compatible timestamp.`);
    return out;
}
function validateImplementation(value) {
    if (!value || typeof value !== "object" || !IMPLEMENTATIONS.has(value.kind ?? ""))
        throw new InvalidCapabilityError("implementation.kind is unsupported.");
    const kind = value.kind;
    if (kind === "mcp") {
        nonEmpty(value.server, "implementation.server");
        nonEmpty(value.tool, "implementation.tool");
    }
    if (kind === "http") {
        const url = new URL(nonEmpty(value.url, "implementation.url"));
        if (url.protocol !== "http:" && url.protocol !== "https:")
            throw new InvalidCapabilityError("implementation.url must use http or https.");
        if (url.username || url.password)
            throw new InvalidCapabilityError("implementation.url cannot embed credentials.");
    }
    if (kind === "browser")
        nonEmpty(value.operation, "implementation.operation");
    if (kind === "desktop") {
        nonEmpty(value.application, "implementation.application");
        nonEmpty(value.operation, "implementation.operation");
    }
    if (kind === "process") {
        nonEmpty(value.profile, "implementation.profile");
        if (value.timeoutMs !== undefined && (!Number.isFinite(value.timeoutMs) || value.timeoutMs <= 0))
            throw new InvalidCapabilityError("implementation.timeoutMs must be positive.");
    }
    if ((kind === "filesystem.read" || kind === "filesystem.write") && value.path !== undefined)
        nonEmpty(value.path, "implementation.path");
    return value;
}
export function createCapabilityCandidate(input) {
    const app = nonEmpty(input.app, "app");
    const capability = nonEmpty(input.capability, "capability");
    const description = nonEmpty(input.description, "description");
    if (!SIDES.has(input.sideEffect))
        throw new InvalidCapabilityError("sideEffect is unsupported.");
    if (!SENSITIVITIES.has(input.sensitivity))
        throw new InvalidCapabilityError("sensitivity is unsupported.");
    if (!RISKS.has(input.risk))
        throw new InvalidCapabilityError("risk is unsupported.");
    const implementation = capabilitySnapshot(validateImplementation(input.implementation));
    if (input.inputSchema === undefined)
        throw new InvalidCapabilityError("inputSchema must be defined; use true for an unconstrained schema.");
    const inputSchema = capabilitySnapshot(input.inputSchema);
    const outputSchema = input.outputSchema === undefined ? undefined : capabilitySnapshot(input.outputSchema);
    const schemaHash = capabilitySha256({ inputSchema, ...(outputSchema === undefined ? {} : { outputSchema }) });
    const id = input.id === undefined ? `${app}.${capability}` : nonEmpty(input.id, "id");
    const provenanceBase = {
        connectorId: nonEmpty(input.provenance.connectorId, "provenance.connectorId"),
        connectorType: nonEmpty(input.provenance.connectorType, "provenance.connectorType"),
        ...(input.provenance.sourceDigest === undefined ? {} : { sourceDigest: nonEmpty(input.provenance.sourceDigest, "provenance.sourceDigest") }),
        ...(input.provenance.version === undefined ? {} : { version: nonEmpty(input.provenance.version, "provenance.version") }),
    };
    const descriptorHash = capabilitySha256({ id, app, capability, description, inputSchema, ...(outputSchema === undefined ? {} : { outputSchema }), sideEffect: input.sideEffect, sensitivity: input.sensitivity, risk: input.risk, implementation });
    const candidateHash = capabilitySha256({ descriptorHash, provenance: provenanceBase });
    return capabilitySnapshot({
        lifecycle: "candidate", id, app, capability, description, inputSchema,
        ...(outputSchema === undefined ? {} : { outputSchema }), schemaHash, descriptorHash,
        sideEffect: input.sideEffect, sensitivity: input.sensitivity, risk: input.risk,
        provenance: { ...provenanceBase, discoveredAt: iso(input.provenance.discoveredAt, "provenance.discoveredAt"), schemaDigest: schemaHash },
        implementation, candidateHash,
    });
}
export function admitCapability(candidate, options) {
    if (!isCapabilityCandidate(candidate))
        throw new CapabilityAdmissionError("Only a valid CapabilityCandidate can be admitted.");
    const admissionId = nonEmpty(options.admissionId, "admissionId");
    const policyVersion = nonEmpty(options.policyVersion, "policyVersion");
    return capabilitySnapshot({
        ...candidate,
        lifecycle: "admitted",
        admission: {
            kind: "function-hooks.capability-admission.v1",
            admissionId,
            admittedAt: iso(options.admittedAt, "admittedAt"),
            policyVersion,
            candidateHash: candidate.candidateHash,
            descriptorHash: candidate.descriptorHash,
            ...(options.reason === undefined ? {} : { reason: nonEmpty(options.reason, "reason") }),
        },
    });
}
export function isCapabilityCandidate(value) {
    if (!value || typeof value !== "object")
        return false;
    const v = value;
    if (v.lifecycle !== "candidate" || typeof v.candidateHash !== "string" || typeof v.descriptorHash !== "string")
        return false;
    try {
        const rebuilt = createCapabilityCandidate({
            id: v.id, app: v.app, capability: v.capability, description: v.description, inputSchema: v.inputSchema,
            ...(v.outputSchema === undefined ? {} : { outputSchema: v.outputSchema }), sideEffect: v.sideEffect, sensitivity: v.sensitivity, risk: v.risk,
            provenance: { connectorId: v.provenance.connectorId, connectorType: v.provenance.connectorType, discoveredAt: v.provenance.discoveredAt, ...(v.provenance.sourceDigest === undefined ? {} : { sourceDigest: v.provenance.sourceDigest }), ...(v.provenance.version === undefined ? {} : { version: v.provenance.version }) },
            implementation: v.implementation,
        });
        return rebuilt.candidateHash === v.candidateHash && rebuilt.descriptorHash === v.descriptorHash && rebuilt.schemaHash === v.schemaHash;
    }
    catch {
        return false;
    }
}
export function isAdmittedCapability(value) {
    if (!value || typeof value !== "object")
        return false;
    const v = value;
    if (v.lifecycle !== "admitted" || v.admission?.kind !== "function-hooks.capability-admission.v1")
        return false;
    try {
        const candidate = { ...v, lifecycle: "candidate" };
        delete candidate.admission;
        if (!isCapabilityCandidate(candidate))
            return false;
        return v.admission.candidateHash === v.candidateHash && v.admission.descriptorHash === v.descriptorHash;
    }
    catch {
        return false;
    }
}
export function assertAdmittedCapability(value) {
    if (!isAdmittedCapability(value))
        throw new CapabilityAdmissionError("Capability is not valid admitted capability evidence.");
}
//# sourceMappingURL=capability.js.map