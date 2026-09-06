# Execution Router — v0.11.0

`@function-hooks/router` is the application-facing routing layer above `@function-hooks/gateway`.

Its purpose is to prevent the system from becoming a collection of bespoke per-application Function Hooks integrations. Applications are described as `(app, capability)` routes and those routes are mapped onto a small set of reusable execution channels:

| Router backend | Gateway event(s) | Typical use |
|---|---|---|
| `mcp` | `mcp.call` | structured MCP/tool servers |
| `api` | `network.request` | HTTP/JSON APIs |
| `browser` | `browser.call` | websites without suitable APIs |
| `desktop` | `desktop.call` | computer/desktop automation hosts |
| `local` | `fs.read`, `fs.write`, `process.exec` | local files and predeclared process capabilities |

The router does **not** authorize execution. A known route still passes through gateway authorization, approval, receipts, audit, cancellation, and host-local enforcement. An unknown route fails before gateway dispatch.

## Example

```ts
const router = createExecutionRouter({
  gateway,
  routes: [
    mcpCapabilityRoute({
      app: "github",
      capability: "repo.read",
      server: "services",
      tool: "github.repo.read",
    }),
    desktopCapabilityRoute({
      app: "vscode",
      capability: "file.open",
      application: "vscode",
      operation: "open-file",
    }),
    processCapabilityRoute({
      app: "project",
      capability: "tests.run",
      profile: "project-tests",
    }),
  ],
});

await router.execute({
  actionId: "action-123",
  app: "github",
  capability: "repo.read",
  input: { repo: "example/project" },
});
```

The route builder cannot provide `actionId`. The router injects the caller's action ID and rejects a route that attempts to forge it. It also writes router-owned provenance metadata:

- `function-hooks.router.app`
- `function-hooks.router.capability`
- `function-hooks.router.backend`

Caller metadata cannot replace those values.

## Security boundary

The router is configuration and dispatch topology, not a trusted identity or authorization system. A compromised or overly permissive route does not gain authority by itself; the resulting gateway event must still pass the gateway's policy and host-adapter controls. Conversely, a gateway policy that simply allows everything remains unsafe even when the router is restrictive.

`desktop.call` is an abstract host callback. v0.9.2 does not ship a universal desktop automation engine and does not grant OS UI access automatically. The host must supply a desktop adapter and gateway allowlist.

## v0.11 admitted-capability compilation

`createExecutionRouterFromRegistry()` snapshots active admitted capabilities and compiles their structured implementation descriptors into ordinary gateway routes. `compileAdmittedCapabilityRoute()` validates admission evidence at runtime. Raw candidates fail before execution. Generated capability/admission metadata is merged as trusted route metadata after caller metadata. Manual routes may be supplied alongside generated routes.
