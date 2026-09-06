# Correct-Once

Freeze repository for **MCP Hooks Upgraded v0.1.1** — a locked MCP/API action path where **B admits** capabilities and **A executes** them only after composition lock.

The git tree holds release docs and the **adapter 0.1.1** source drop. The full upstream A/B source bundle ships as a GitHub Release asset (not in git).

| Link | URL |
| --- | --- |
| Release | https://github.com/dawsonblock/Correct-Once/releases/tag/v0.1.1 |
| Freeze zip | https://github.com/dawsonblock/Correct-Once/releases/download/v0.1.1/mcp-hooks-upgraded-v0.1.1.zip |
| SHA256 | `d9b4292e6b2cb1d1314e2d1a4edf16db423a2248e7d9201393e0a1027d1eef8f` |

---

## What it is

A **curated, fail-closed** bridge between:

- **B** — `function-hooks-core-reference` **0.11.0** — admits capabilities into a catalog (admission / constraint source of truth).
- **A** — `effect-fabric` **0.2.11** — runs admitted work through `EffectGateway` (runtime bridge).
- **Adapter** — **0.1.1** — stamps a **module-private composition lock** on `mcp.call` and requires hosts to boot through the locked entrypoint.

Agents only see two curated tools:

- `search_capabilities`
- `invoke_capability(id, args)`

Invokes that touch MCP go through A with a **pinned schema digest**. Unknown ops and schema drift are **denied**. Each capability is tagged `read | write | destructive` (from B `sideEffect`). **Destructive defaults OFF** — explicit allow required.

Flow (from `adapter/README.md`):

```text
B createCapabilityCandidate → admitCapability → registry.register
        ↓ (export active admitted records only)
adapter/admitted-registry/v1 JSON  (no tokens, no floating latest)
        ↓
A EffectDefinitionFactory + EffectGateway.register_tool  (schema pin = B inputSchema)
        ↓
curated MCP surface: search_capabilities / invoke_capability
        ↓
A GatewayPolicy.authorize + adapter call-time re-check → EffectGateway.call_tool
```

---

## Critical path (mandatory)

Quoted host-composition pattern from `adapter/README.md` / `adapter/FIXES.md` / `RELEASE-mcp-hooks-v0.1.1.md`:

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

Why this matters:

- Brand is a **module-private** `Symbol(...)` (not `Symbol.for`, not exported) — cannot be forged by name from outside the module.
- `createEffectLockedAgentGateway` **always** runs `assertMcpCallIsEffectLocked` **before** `createAgentGateway`.
- Composition: `composeEffectLockedMcpOptions` → `createNodeGatewayAdapters({ mcpCall })` → `createEffectLockedAgentGateway(...)`.

**Do not** call bare `createAgentGateway` with an unlocked `mcp.call`.

---

## Security gates

At **call time**, Security Expert posture (fail closed):

| Gate | Behavior |
| --- | --- |
| Admitted id | Only catalog-admitted capability ids |
| Class / allowlist | Re-check identity + allowlist class + scope |
| Schema digest | Pin must match; drift → deny |
| Unknown ops | Deny |
| Raw MCP | No raw MCP SDK path; `assertNoManualMcpRoutes` refuses MCP manual routes |
| Destructive | Requires explicit allow flag; **default OFF** |
| Secrets | No tokens in schemas/receipts; never mint from floating `latest` |

One-line boundary: **admitted id + class + schema digest must all pass at call time, or deny** — including destructive when default OFF.

---

## Pins and integrity

| Component | Version | Role |
| --- | --- | --- |
| `effect-fabric` | `0.2.11` | A — executes admitted effects |
| `function-hooks-core-reference` | `0.11.0` | B — admits and gates capability traffic |
| `adapter` | `0.1.1` | Locked adapter surface under `adapter/` |

Full non-git bundle:

- File: `mcp-hooks-upgraded-v0.1.1.zip`
- SHA256: `d9b4292e6b2cb1d1314e2d1a4edf16db423a2248e7d9201393e0a1027d1eef8f`
- Sidecar in tree: `mcp-hooks-upgraded-v0.1.1.sha256`
- Target commit for tag `v0.1.1`: `main` @ `32f55ca2e2acd9605287aa668a046edc89af31f8`

Verify smoke (mirrored gates):

```bash
python3 adapter/fixtures/run_smoke.py
```

---

## What it is not

- **Not** OpenAPI → tool codegen / FastMCP `from_openapi` for these archives.
- **Not** one-tool-per-endpoint surface — only `search_capabilities` + `invoke_capability`.
- **Not** a live `effect_fabric` proof via smoke — `adapter/fixtures/run_smoke.py` is an explicit **mirror** of the gates (four Security Expert fixtures + composition-lock brand checks). It does **not** import `effect_fabric` and does **not** prove live A integration.
- **Not** a full package install or production policy engine — minimal fail-closed wiring verified against archive symbols.
- **Not** a vendor of full A/B trees into git — those live in the release zip.

---

## Host residual (unsupported)

If a host skips `createEffectLockedAgentGateway` and boots a **bare** `createAgentGateway`, the composition lock is **not** enforced. That path is **unsupported**. Always use the locked entrypoint.

---

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

- `LICENSE` — unchanged.
- `README.md` — this freeze overview.
- `RELEASE-mcp-hooks-v0.1.1.md` — release-only notes.
- `mcp-hooks-upgraded-v0.1.1.sha256` — exact bundle checksum.
- `adapter/` — v0.1.1 source drop (`VERSION`, docs, `ts/`, `python/`, `fixtures/`).

---

## Safety notes

- No secrets, tokens, or credentials belong in this repository.
- Destructive behavior remains disabled by default.
- Smoke stays on mirrored gates until a separate change explicitly authorizes live execution paths.
