export class CapabilityError extends Error {
    constructor(message, options) { super(message, options); this.name = new.target.name; }
}
export class InvalidCapabilityError extends CapabilityError {
}
export class CapabilityAdmissionError extends CapabilityError {
}
export class CapabilityRegistryError extends CapabilityError {
}
export class CapabilityRegistryConflictError extends CapabilityRegistryError {
}
export class CapabilityNotFoundError extends CapabilityRegistryError {
}
export class CapabilityStateError extends CapabilityRegistryError {
}
//# sourceMappingURL=errors.js.map