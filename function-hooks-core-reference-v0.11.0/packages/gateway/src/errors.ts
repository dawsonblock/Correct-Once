import { FunctionHooksError } from "@function-hooks/core";

export class GatewayError extends FunctionHooksError {}
export class GatewayInvalidActionError extends GatewayError {}
export class GatewayDeniedError extends GatewayError {}
export class GatewayApprovalRequiredError extends GatewayDeniedError {}
export class GatewayApprovalDeniedError extends GatewayDeniedError {}
export class GatewayInvalidRewriteError extends GatewayDeniedError {}
export class GatewayAdapterUnavailableError extends GatewayError {}
export class GatewayHostPolicyError extends GatewayDeniedError {}
export class GatewayExecutionError extends GatewayError {}
export class GatewayOutputLimitError extends GatewayExecutionError {}
