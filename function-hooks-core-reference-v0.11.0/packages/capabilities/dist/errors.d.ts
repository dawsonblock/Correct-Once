export declare class CapabilityError extends Error {
    constructor(message: string, options?: ErrorOptions);
}
export declare class InvalidCapabilityError extends CapabilityError {
}
export declare class CapabilityAdmissionError extends CapabilityError {
}
export declare class CapabilityRegistryError extends CapabilityError {
}
export declare class CapabilityRegistryConflictError extends CapabilityRegistryError {
}
export declare class CapabilityNotFoundError extends CapabilityRegistryError {
}
export declare class CapabilityStateError extends CapabilityRegistryError {
}
//# sourceMappingURL=errors.d.ts.map