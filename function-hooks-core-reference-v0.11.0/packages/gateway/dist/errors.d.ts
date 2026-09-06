import { FunctionHooksError } from "@function-hooks/core";
export declare class GatewayError extends FunctionHooksError {
}
export declare class GatewayInvalidActionError extends GatewayError {
}
export declare class GatewayDeniedError extends GatewayError {
}
export declare class GatewayApprovalRequiredError extends GatewayDeniedError {
}
export declare class GatewayApprovalDeniedError extends GatewayDeniedError {
}
export declare class GatewayInvalidRewriteError extends GatewayDeniedError {
}
export declare class GatewayAdapterUnavailableError extends GatewayError {
}
export declare class GatewayHostPolicyError extends GatewayDeniedError {
}
export declare class GatewayExecutionError extends GatewayError {
}
export declare class GatewayOutputLimitError extends GatewayExecutionError {
}
//# sourceMappingURL=errors.d.ts.map