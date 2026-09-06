export class FunctionHooksError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class RuntimeStateError extends FunctionHooksError {}
export class RuntimeClosedError extends RuntimeStateError {}
export class UnknownEventError extends FunctionHooksError {}
export class DuplicateEventError extends FunctionHooksError {}
export class InvalidBlueprintError extends FunctionHooksError {}
export class InvalidEventNameError extends InvalidBlueprintError {}
export class UnsupportedEventValueError extends FunctionHooksError {}
export class NextMultiplicityError extends FunctionHooksError {}
export class DispatchCancelledError extends FunctionHooksError {}
export class DispatchTimeoutError extends DispatchCancelledError {}
export class HookExecutionError extends FunctionHooksError {}
export class BaseExecutionError extends FunctionHooksError {}
