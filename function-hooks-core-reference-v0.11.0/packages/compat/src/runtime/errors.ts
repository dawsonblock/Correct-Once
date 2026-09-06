export class FunctionHooksError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = new.target.name; }
}
export class UnknownEventError extends FunctionHooksError {}
export class DuplicateEventError extends FunctionHooksError {}
export class InvalidBlueprintError extends FunctionHooksError {}
export class BottomHookError extends FunctionHooksError {}
export class DispatchBudgetError extends FunctionHooksError {}
export class DispatchTimeoutError extends DispatchBudgetError {}
export class MessageSizeError extends DispatchBudgetError {}
export class NextMultiplicityError extends DispatchBudgetError {}
