# Correct-Once

`Correct-Once` now contains the full in-tree freeze for **MCP Hooks Upgraded
v0.1.1**: the adapter source drop, the `effect-fabric` v0.2.11 freeze tree,
and the `function-hooks-core-reference` v0.11.0 freeze tree.

It also contains the merged `function-hooks-runtime-v0.12/` scaffold. That
runtime directory is **not** a production claim for 0.12. The current work on
top of it is a v0.13 correctness track that hardens admit-time class gating,
subject/auth requirements, idempotency, and effect-client bridging without
loosening the sealed v0.1.1 freeze trees.

The imported source of truth is the GitHub release asset:

- File:
  `mcp-hooks-upgraded-v0.1.1.zip`
- Release URL:
  `https://github.com/dawsonblock/Correct-Once/releases/download/v0.1.1/mcp-hooks-upgraded-v0.1.1.zip`
- SHA256:
  `d9b4292e6b2cb1d1314e2d1a4edf16db423a2248e7d9201393e0a1027d1eef8f`

That exact checksum is also stored in `mcp-hooks-upgraded-v0.1.1.sha256`.

## Frozen component pins and active runtime track

| Component | Version | Role |
| --- | --- | --- |
| `effect-fabric` | `0.2.11` | A executes admitted effects |
| `function-hooks-core-reference` | `0.11.0` | B admits and gates capability traffic |
| `adapter` | `0.1.1` | Locked adapter surface and smoke fixtures |
| `function-hooks-runtime` | `0.12 scaffold` | v0.13 correctness-only runtime track; not a production 0.12 release |

## What this repository is

This freeze is a **curated, fail-closed bridge**:

- **B admits** capabilities via `function-hooks-core-reference` records.
- **A executes** only after the admitted MCP shape has been pinned and
  composition-locked.
- The exposed tool surface stays intentionally tiny:
  `search_capabilities` and `invoke_capability`.

The critical host path is:

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

`composeEffectLockedMcpOptions` and
`createEffectLockedAgentGateway` are the required composition path. The lock is
module-private, asserted before `createAgentGateway`, and intended to fail
closed when hosts try to boot with an unlocked `mcp.call`.

## Repository layout

The freeze tree is now vendored directly at repo root:

```text
.
├── LICENSE
├── Makefile
├── README.md
├── RELEASE.md
├── adapter/
├── effect-fabric-v0.2.11/
├── function-hooks-runtime-v0.12/
├── function-hooks-core-reference-v0.11.0/
└── mcp-hooks-upgraded-v0.1.1.sha256
```

Notes:

- `adapter/` is the freeze adapter 0.1.1 source tree.
- `effect-fabric-v0.2.11/` preserves the shipped freeze wrapper; the actual
  Python install root is
  `effect-fabric-v0.2.11/source/effect-fabric-0.2.11/`.
- `function-hooks-runtime-v0.12/` is the parallel runtime scaffold now being
  corrected in-place for the v0.13 correctness release. It is first-class for
  install/typecheck/test/smoke, but it is not blessed as production 0.12.
- `function-hooks-core-reference-v0.11.0/` contains the Node workspace, shipped
  `dist/`, package sources, and release evidence.
- `RELEASE.md` is the freeze release note from the verified zip.

## Install from a clean clone

Prereqs:

- Python `>=3.11`
- Node `>=20`
- `npm`

You can use the root `Makefile` helpers or run the commands directly.

### Install A (`effect-fabric` 0.2.11)

Direct command:

```bash
python3 -m pip install -e "effect-fabric-v0.2.11/source/effect-fabric-0.2.11[api,dev]"
```

Make target:

```bash
make install-a
```

### Install B (`function-hooks-core-reference` 0.11.0)

Direct command:

```bash
cd function-hooks-core-reference-v0.11.0
npm ci
```

Make target:

```bash
make install-b
```

### Install the runtime scaffold (`function-hooks-runtime-v0.12`)

Direct command:

```bash
cd function-hooks-runtime-v0.12
npm ci
```

Make target:

```bash
make install-runtime
```

If you want to rebuild the shipped workspace artifacts locally:

```bash
make build-b
```

### Typecheck and test the runtime scaffold

Direct commands:

```bash
cd function-hooks-runtime-v0.12
npm run typecheck
npm test
```

Make targets:

```bash
make typecheck
make test
```

### Live qualification

The root qualification target now drives the release-blocker proofs directly:

```bash
make qualify
```

It runs:

- the locked `function-hooks-core-reference-v0.11.0/` rebuild;
- `function-hooks-runtime-v0.12/` typecheck plus runtime unit tests;
- the live Python adapter + Effect Fabric tests;
- the TS -> Effect Fabric -> fake-MCP cross-language suite; and
- `sha256sum --check function-hooks-core-reference-v0.11.0/MANIFEST.sha256`.

It does **not** claim the PostgreSQL-only Effect Fabric gates passed locally. Those
still require `EFFECT_FABRIC_TEST_POSTGRES_DSN` and remain outside this archive-only
qualification path.

## Smoke and import checks

Mirrored adapter smoke:

```bash
python3 adapter/fixtures/run_smoke.py
```

or:

```bash
make smoke
```

`make smoke` is now the official root smoke for the runtime track as well: it
runs `make smoke-runtime` first and only reaches the mirrored adapter smoke if
the runtime fail-closed fixtures pass. A runtime regression therefore fails the
root smoke command immediately.

If you want to run only the runtime smoke fixtures:

```bash
make smoke-runtime
```

Optional install verification commands:

```bash
make smoke-a-import
make smoke-b-import
```

Important honesty boundary: `adapter/fixtures/run_smoke.py` is a **mirrored
gate smoke**. It checks the adapter's fail-closed rules and composition-lock
branding, but it does **not** import a live `effect_fabric` runtime and does
**not** prove end-to-end A execution. Likewise, even a passing `make qualify`
does **not** upgrade `function-hooks-runtime-v0.12/` into a production 0.12
claim or a packaging-ready release; the correctness track is still explicitly
bounded to v0.13 blocker fixes.

## Security gates

The freeze keeps these gates closed by default:

- only admitted capability ids are eligible;
- curated tools stay limited to `search_capabilities` and `invoke_capability`;
- `provenance.schemaDigest` must match `schemaHash`;
- unknown operations fail closed;
- raw/manual MCP routes are refused by `assertNoManualMcpRoutes`;
- destructive behavior requires explicit opt-in and defaults to OFF;
- no secrets, tokens, or credentials should be committed in this repository.

## Host residual

The unsupported path is a host that calls bare `createAgentGateway` with an
unlocked `mcp.call`. The freeze does not bless that path. Hosts should compose
through `composeEffectLockedMcpOptions` and then boot through
`createEffectLockedAgentGateway`.

## What this repository is not

- Not an OpenAPI codegen or FastMCP `from_openapi` project.
- Not a one-tool-per-endpoint export. The frozen surface is only
  `search_capabilities` and `invoke_capability`.
- Not a relaxation of the composition lock or destructive default.
- Not a claim that mirrored smoke alone proves live `effect_fabric`
  integration.
