# Correct-Once

`Correct-Once` is the freeze repository for **MCP Hooks Upgraded v0.1.1**. The
git tree carries the release documentation and the adapter 0.1.1 source drop,
while the full upstream A/B source bundle stays outside git as a release asset.

## Freeze summary

- **B admits / A executes**: `function-hooks-core-reference` (B) admits and
  constrains capability requests; `effect-fabric` (A) executes only after that
  admitted shape has been composition-locked.
- **Curated tools only**: the exposed tool surface is limited to
  `search_capabilities` and `invoke_capability`.
- **Composition lock is mandatory**:
  `createEffectLockedAgentGateway` uses a module-private `Symbol` (not
  `Symbol.for`) and always asserts the lock before calling
  `createAgentGateway`.
- **Destructive default is OFF**: destructive execution requires an explicit
  opt-in and is not the default adapter posture.
- **Smoke coverage uses mirrored gates**: smoke validation mirrors the gating
  path and does **not** point at a live `effect_fabric`.
- **Full bundle integrity**: the complete source bundle is shipped separately as
  `mcp-hooks-upgraded-v0.1.1.zip` with SHA256
  `d9b4292e6b2cb1d1314e2d1a4edf16db423a2248e7d9201393e0a1027d1eef8f`.

## Frozen component pins

| Component | Version | Role in freeze |
| --- | --- | --- |
| `effect-fabric` | `0.2.11` | A executes admitted effects |
| `function-hooks-core-reference` | `0.11.0` | B admits and gates capability traffic |
| `adapter` | `0.1.1` | Locked adapter surface documented and stored in `adapter/` |

## Architecture contract

The freeze keeps the execution model intentionally narrow:

1. B admits the request shape and tool name.
2. Only curated tools are forwarded: `search_capabilities` and
   `invoke_capability`.
3. The adapter stamps a **module-private composition lock**.
4. The lock is asserted before `createAgentGateway` is allowed to run.
5. Execution stays non-destructive by default.
6. Smoke validation exercises mirrored gates rather than a live
   `effect_fabric`.

This repository does **not** vendor the full `effect-fabric` or
`function-hooks-core-reference` trees into git. The canonical full bundle is the
release asset `mcp-hooks-upgraded-v0.1.1.zip` at the SHA256 listed above.

## Critical-path code snippet

Quoted host-composition pattern from `adapter/README.md` and `adapter/FIXES.md`:

```ts
import { createNodeGatewayAdapters } from "@function-hooks/gateway";
import {
  composeEffectLockedMcpOptions,
  createEffectLockedAgentGateway,
  assertNoManualMcpRoutes,
} from "./adapter/ts/composeLockedAdapters.js";

assertNoManualMcpRoutes(manualRoutes);
const { mcpCall } = composeEffectLockedMcpOptions(effectGateway);
const adapters = await createNodeGatewayAdapters({ /* roots */, mcpCall });
await createEffectLockedAgentGateway(createAgentGateway, { /* opts */, adapters });
```

Why it matters:

- `Symbol(...)` keeps the lock module-private. `Symbol.for(...)` would allow
  unrelated code to spoof the same registry key across realms.
- The assert runs **before** `createAgentGateway`, so unlocked composition fails
  closed instead of slipping into execution.
- Tool admission is intentionally tiny and auditable.

## Release asset integrity

The full non-git bundle for this freeze is:

- File: `mcp-hooks-upgraded-v0.1.1.zip`
- SHA256:
  `d9b4292e6b2cb1d1314e2d1a4edf16db423a2248e7d9201393e0a1027d1eef8f`

The exact checksum line is also stored in
`mcp-hooks-upgraded-v0.1.1.sha256`.

## Repository layout

```text
.
├── LICENSE
├── README.md
├── RELEASE-mcp-hooks-v0.1.1.md
├── mcp-hooks-upgraded-v0.1.1.sha256
└── adapter/
    ├── FIXES.md
    ├── MAPPING.md
    ├── README.md
    ├── VERSION
    ├── fixtures/
    ├── python/
    └── ts/
```

- `LICENSE` stays unchanged.
- `README.md` is the modern freeze overview.
- `RELEASE-mcp-hooks-v0.1.1.md` captures the release-only notes.
- `mcp-hooks-upgraded-v0.1.1.sha256` records the bundle checksum exactly.
- `adapter/` now contains the v0.1.1 source drop (`VERSION`, `README`,
  `FIXES`, `MAPPING`, `ts/`, `python/`, `fixtures/`). The large upstream A/B
  trees are intentionally omitted from git.

## Safety notes

- No secrets, tokens, or credentials belong in this repository.
- Destructive behavior remains disabled by default.
- Smoke checks should keep using mirrored gates until a separate change
  explicitly authorizes live execution paths.
