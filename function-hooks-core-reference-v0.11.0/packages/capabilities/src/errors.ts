export class CapabilityError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = new.target.name; }
}
export class InvalidCapabilityError extends CapabilityError {}
export class CapabilityAdmissionError extends CapabilityError {}
export class CapabilityRegistryError extends CapabilityError {}
export class CapabilityRegistryConflictError extends CapabilityRegistryError {}
export class CapabilityNotFoundError extends CapabilityRegistryError {}
export class CapabilityStateError extends CapabilityRegistryError {}
