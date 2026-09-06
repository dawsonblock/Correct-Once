import { FunctionHooksError } from "@function-hooks/core";

export class SchemaValidationError extends FunctionHooksError {}
export class ActionReceiptConflictError extends FunctionHooksError {}
export class IndeterminateActionError extends FunctionHooksError {}
export class SchemaVersionError extends FunctionHooksError {}
