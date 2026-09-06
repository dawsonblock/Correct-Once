export declare class FunctionHooksError extends Error {
    constructor(message: string, options?: ErrorOptions);
}
export declare class UnknownEventError extends FunctionHooksError {
}
export declare class DuplicateEventError extends FunctionHooksError {
}
export declare class InvalidBlueprintError extends FunctionHooksError {
}
export declare class BottomHookError extends FunctionHooksError {
}
export declare class DispatchBudgetError extends FunctionHooksError {
}
export declare class DispatchTimeoutError extends DispatchBudgetError {
}
export declare class MessageSizeError extends DispatchBudgetError {
}
export declare class NextMultiplicityError extends DispatchBudgetError {
}
//# sourceMappingURL=errors.d.ts.map