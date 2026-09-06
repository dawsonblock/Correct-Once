export declare class FunctionHooksError extends Error {
    constructor(message: string, options?: ErrorOptions);
}
export declare class RuntimeStateError extends FunctionHooksError {
}
export declare class RuntimeClosedError extends RuntimeStateError {
}
export declare class UnknownEventError extends FunctionHooksError {
}
export declare class DuplicateEventError extends FunctionHooksError {
}
export declare class InvalidBlueprintError extends FunctionHooksError {
}
export declare class InvalidEventNameError extends InvalidBlueprintError {
}
export declare class UnsupportedEventValueError extends FunctionHooksError {
}
export declare class NextMultiplicityError extends FunctionHooksError {
}
export declare class DispatchCancelledError extends FunctionHooksError {
}
export declare class DispatchTimeoutError extends DispatchCancelledError {
}
export declare class HookExecutionError extends FunctionHooksError {
}
export declare class BaseExecutionError extends FunctionHooksError {
}
//# sourceMappingURL=errors.d.ts.map