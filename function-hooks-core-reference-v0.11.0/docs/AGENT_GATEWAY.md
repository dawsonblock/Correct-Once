# Agent Action Gateway

`@function-hooks/gateway` is the first real application layer built on the frozen `1.0-rc.1` Function Hooks kernel contract. It is deliberately above the kernel: no gateway behavior changes hook ordering, continuation multiplicity, matching, lifecycle, cancellation, or recursion semantics.

## Action surface

The gateway publishes seven explicit events:

- `mcp.call`
- `browser.call`
- `desktop.call`
- `fs.read`
- `fs.write`
- `process.exec`
- `network.request`

Every action carries a non-empty `actionId`. The gateway validates the minimum dispatch shape before authorization and validates policy rewrites again before they enter the lower chain. A rewrite may not replace `actionId`; execution identity is immutable across authorization.

## Authority order

```text
agent / caller
    |
    v
0   gateway-policy              deny / rewrite / require approval
    |
20  action-receipts             replay completed; fail closed on indeterminate
    |
40  gateway-execution-audit     record the effective input that will execute
    |
100 gateway-executor            host adapter receives AbortSignal
    |
    v
MCP / browser / filesystem / process / network
```

Lower numeric order has greater wrapping authority. Policy denial occurs before receipts and execution. Receipt replay occurs before execution audit, so a completed duplicate is not falsely recorded as another execution.

## Fail-closed defaults

`createAgentGateway()` installs a deny-all authorizer if none is provided. `origin` is only the kernel's diagnostic origin label and must not be treated as authenticated identity. A real host should bind authenticated principal/tenant information outside this kernel and feed it to its own authorization policy.

The default receipt store is process-local `InMemoryActionReceiptStore`. It prevents duplicate execution within one process but does **not** provide crash durability. Use `FileActionReceiptStore` for single-process crash/reopen durability or another durable `ActionReceiptStore` for stronger guarantees. The file store serializes concurrent transitions within one opened instance and poisons that instance after persistence failure; it is not a multi-process/distributed receipt database.

## Node host boundary

`createNodeGatewayAdapters()` adds a host-local layer independent of the agent policy:

- filesystem reads/writes are contained beneath a realpath-resolved `fsRoot`;
- lexical `..` escapes and symlink escapes are rejected;
- process execution uses `spawn(..., { shell: false })`;
- process execution defaults to named capability profiles rather than raw commands;
- profiles bind executable, fixed arguments, optional caller-argument validation, cwd root, explicit environment, time/output caps, and optional executable SHA-256;
- child processes never inherit the gateway host's ambient environment;
- deprecated raw-command execution is denied unless the host explicitly sets `allowLegacyProcessCommands: true`;
- process time and combined output are capped;
- dispatch cancellation is propagated to the child process;
- network origins and HTTP methods are exact-match allowlisted;
- redirects are returned without being followed;
- response bodies are streamed and rejected as soon as the byte cap is exceeded;
- MCP and browser actions require explicit host callbacks.

Policy allowlisting and host allowlisting are intentionally redundant. A permissive policy should not automatically grant ambient host authority.

## Cancellation and side effects

Cancellation is cooperative. The gateway passes the dispatch `AbortSignal` into execution adapters, but it never claims rollback. A process may have already written data, a network request may already have reached a server, or an MCP tool may already have committed an action before cancellation is observed.

If execution completes but a lower assurance step fails afterward, durable receipts are expected to move the action to `indeterminate`, preventing blind retry.

## Qualification scope

The v0.10.0 suite runs hostile end-to-end checks for default denial, approval denial, rewrites, receipt conflicts/replay, indeterminate post-side-effect failure, nested-dispatch policy re-entry, cancellation propagation, tamper-evident audit, path traversal, symlink escape, process-profile enforcement, environment isolation, output bounds, exact network-origin allowlisting, redirect suppression, response-size bounds, MCP tool allowlisting, and browser-operation allowlisting.

The package does not claim that arbitrary MCP servers, browsers, containers, or remote systems are secure merely because they are connected through this gateway. Their own isolation and authentication boundaries remain separate concerns.

## v0.10 Node host hardening

The Node adapter adds four higher-assurance controls without changing gateway event semantics. File-backed receipt/audit stores coordinate cooperating processes through exclusive lock/reload transactions. POSIX process profiles use an isolated process group by default so timeout/cancellation escalation reaches ordinary descendants. Linux file I/O can be descriptor-anchored through `/proc/self/fd` with `O_NOFOLLOW` and atomic replacement. HTTP(S) requests resolve and validate DNS answers before connect, reject non-global addresses by default, and pin socket lookup to the checked address.

`networkAllowPrivateAddresses: true`, `filesystemSecurity: legacy`, and `processTreeIsolation: direct` are explicit trust/compatibility downgrades. They should not be enabled for hostile-agent execution merely to make a test pass.

These controls are host boundaries, not authenticated identity, distributed consensus, or an unescapable sandbox.
