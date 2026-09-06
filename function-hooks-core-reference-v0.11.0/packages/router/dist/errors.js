export class ExecutionRouterError extends Error {
    constructor(message, options) { super(message, options); this.name = new.target.name; }
}
export class InvalidRoutedActionError extends ExecutionRouterError {
}
export class InvalidCapabilityRouteError extends ExecutionRouterError {
}
export class DuplicateCapabilityRouteError extends ExecutionRouterError {
}
export class CapabilityRouteNotFoundError extends ExecutionRouterError {
}
//# sourceMappingURL=errors.js.map