import type { AdmitCapabilityOptions, AdmittedCapability, CapabilityCandidate, CreateCapabilityCandidateInput } from "./types.js";
export declare function createCapabilityCandidate(input: CreateCapabilityCandidateInput): CapabilityCandidate;
export declare function admitCapability(candidate: CapabilityCandidate, options: AdmitCapabilityOptions): AdmittedCapability;
export declare function isCapabilityCandidate(value: unknown): value is CapabilityCandidate;
export declare function isAdmittedCapability(value: unknown): value is AdmittedCapability;
export declare function assertAdmittedCapability(value: unknown): asserts value is AdmittedCapability;
//# sourceMappingURL=capability.d.ts.map