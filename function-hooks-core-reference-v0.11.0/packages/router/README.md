# @function-hooks/router

A thin application-capability routing layer above `@function-hooks/gateway`.

Applications do not receive bespoke Function Hooks integrations. Instead, `(app, capability)` routes are mapped onto a small set of reusable execution backends: MCP, HTTP/API, browser automation, desktop/computer control, or local filesystem/process capabilities. The router owns `actionId`, adds route provenance metadata, and sends the resulting action through the normal gateway policy, approval, receipt, audit, and host-execution boundaries.

The router is not an authorization boundary. Unknown routes fail closed, but all real authority remains in the gateway and host adapters.

## Admitted capability registry

For automatic routing, use `createExecutionRouterFromRegistry()`. It compiles only active `AdmittedCapability` records from `@function-hooks/capabilities`. Raw discovery candidates are rejected. Manual routes remain available for specialized transformations.
