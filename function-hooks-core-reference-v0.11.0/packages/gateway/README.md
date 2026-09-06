# @function-hooks/gateway

A production-shaped action gateway built above the frozen Function Hooks kernel. It exposes explicit events for MCP, browser, desktop, filesystem, process, and network actions and composes four boundaries in order: authorization/approval, retry-safe action receipts, execution audit, and host execution.

The package is fail-closed by default: `createAgentGateway()` installs a deny-all authorizer unless the host explicitly supplies one. Kernel `origin` values remain diagnostic labels and are not treated as authenticated identities.

`createNodeGatewayAdapters()` adds a second host-local boundary for filesystem roots, named process capability profiles, network origin/method allowlists, output caps, non-shell process spawning, redirect suppression, and cooperative cancellation. Process profiles never inherit the parent environment; raw executable execution is a deprecated explicit opt-in only. MCP and browser execution are explicit callbacks supplied by the embedding host.

See the repository's `docs/AGENT_GATEWAY.md` and `examples/agent-gateway-demo.ts` for end-to-end usage.
