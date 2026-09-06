export class RuntimeCapabilityError extends Error {}

export class RuntimeExecutionPolicyError extends RuntimeCapabilityError {}

export class RuntimeCapabilityNotFoundError extends RuntimeCapabilityError {}

export class RuntimeCapabilityStateError extends RuntimeCapabilityError {}

export class RuntimePolicyHookError extends RuntimeCapabilityError {}

export class RuntimeEffectExecutionDeniedError extends RuntimeCapabilityError {}
