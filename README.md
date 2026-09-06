# Correct-Once

Fail-closed MCP capability bridge: **B admits**, **A executes**, with a tiered Function Hooks runtime on top.

Current default branch tip lands **v0.15 Cross-Layer Authority Qualification** (PR #8, squash `9eb268bb`). That closes EF provenance, qualify integrity, fast-READ epoch, unified write-identity, and pinned `inputSchema` validation. It does **not** mint a packaging release.

| Claim | Status |
| --- | --- |
| Sealed MCP Hooks freeze **v0.1.1** (adapter + B 0.11.0) | Present |
| Effect Fabric **0.2.12** (wheel == source, installed-wheel qualify) | Present |
| Runtime track through **v0.15** authority closure | On `main` |
| Production packaging / `RELEASE_QUALIFIED` | **Blocked** |
| EF Postgres durability gates | Env-limited (often skipped without `EFFECT_FABRIC_TEST_POSTGRES_DSN`) |

## Pins

| Component | Version | Role |
| --- | --- | --- |
| `effect-fabric` | `0.2.12` | A — executes admitted effects; trusted write identity + CRITICAL schema revalidation |
| `function-hooks-core-reference` | `0.11.0` | B — admits and gates capability traffic |
| `adapter` | `0.1.1` (+ v0.15 gates) | Locked curated MCP surface; live revoke + write-identity + schema deny |
| `function-hooks-runtime` | `0.12` scaffold + v0.13–v0.15 closures | Tiered pure / read / mutation / critical; **not** a production 0.12 packaging claim |

Historical freeze zip (import checksum for the original adapter+B drop):

- File: `mcp-hooks-upgraded-v0.1.1.zip`
- Release: `https://github.com/dawsonblock/Correct-Once/releases/download/v0.1.1/mcp-hooks-upgraded-v0.1.1.zip`
- SHA256: `d9b4292e6b2cb1d1314e2d1a4edf16db423a2248e7d9201393e0a1027d1eef8f` (also in `mcp-hooks-upgraded-v0.1.1.sha256`)

> That zip predates EF **0.2.12** and the runtime authority closures. Prefer in-tree `main` for current behavior.

## Track lineage (correctness only)

1. **v0.1.1 freeze** — curated catalog, composition lock, destructive default OFF.
2. **v0.12 scaffold** — tiered execution (pure / read / mutation / critical).
3. **v0.13** — admit-time class matrix, guarded idempotency, receipt reconciliation, branded Effect client.
4. **v0.14** — unified write identity into Effect Fabric, live B revocation, cross-language suite, locked rebuild.
5. **v0.15** (on `main`) — EF 0.2.12 provenance (no in-place 0.2.11 patch), qualify fails closed on integrity + `qualification/**` typecheck, fast-READ pre-I/O epoch, shared write-identity vectors, pinned `inputSchema` before external exec (+ gateway CRITICAL).

## What this repository is

A **curated, fail-closed bridge**:

- **B admits** capabilities via `function-hooks-core-reference` records.
- **Runtime** selects executor by admit-time `executionClass` (not model-chosen at call time).
- **A / Effect Fabric** runs critical/high-consequence effects with trusted identity + schema pins.
- Exposed tool surface stays tiny: `search_capabilities` and `invoke_capability`.

### Host composition path (mandatory)

```ts
import { createNodeGatewayAdapters } from "@function-hooks/gateway";
import {
  composeEffectLockedMcpOptions,
  createEffectLockedAgentGateway,
} from "./adapter/ts/composeLockedAdapters.js";
import { assertNoManualMcpRoutes } from "./adapter/ts/effectGatewayMcpCall.js";

assertNoManualMcpRoutes(manualRoutes);
const { mcpCall } = composeEffectLockedMcpOptions(effectGateway);
const adapters = await createNodeGatewayAdapters({ /* roots */, mcpCall });
await createEffectLockedAgentGateway(createAgentGateway, { /* opts */, adapters });
```

### Tiered execution (runtime)

| Class | Path | Notes |
| --- | --- | --- |
| `pure` | In-process handler only | No network / FS / side effects |
| `read` | Fast path | Subject/allowlist re-check every call; pre-I/O epoch; MCP descriptor freshness |
| `mutation` | Guarded direct | Caller `idempotencyKey` required; receipts; no silent fallback to Effect |
| `critical` | Effect Fabric | Trusted write identity; pinned schema revalidation at gateway |

## Repository layout

```text
.
├── LICENSE
├── Makefile
├── README.md
├── RELEASE.md                    # historical v0.1.1 freeze note (see honesty)
├── adapter/
├── effect-fabric-v0.2.12/
├── function-hooks-runtime-v0.12/
├── function-hooks-core-reference-v0.11.0/
├── qualification/
│   └── write-identity-vectors.json
└── mcp-hooks-upgraded-v0.1.1.sha256
```

## Install / verify

Prereqs: Python `>=3.11`, Node `>=20`, `npm`.

```bash
make install-a && make install-b && make install-runtime
make typecheck && make test && make smoke
make qualify
```

`make qualify` should fail closed on EF integrity FAIL; includes `typecheck:qualification`, installed-wheel cross-language, and B `MANIFEST.sha256`. Postgres gates need `EFFECT_FABRIC_TEST_POSTGRES_DSN`.

## Security gates (current)

- admitted ids only; curated tools only; schemaDigest == schemaHash; no raw MCP routes; destructive default OFF
- admit-time `executionClass` pinned (no disguised write-as-read)
- fast READ: pre-I/O epoch + MCP descriptor freshness
- mutation/critical: caller `idempotencyKey` required (no payload-invented keys)
- `action_id` / `callerCorrelationId` = correlation only; trusted ids derived internally
- metadata non-semantic by default; only `semanticMetadata` in action digest
- pinned `inputSchema` validate before external exec; gateway CRITICAL revalidate
- no secrets in tree

## Honesty boundaries

- Not `RELEASE_QUALIFIED`. Not a production 0.12 packaging claim.
- `RELEASE.md` is the historical v0.1.1 freeze note — treat in-tree EF 0.2.12 + this README as current for EF/authority.
- Mirrored smoke ≠ live A proof; branding ≠ crypto; Postgres may skip without DSN.

## What this is not

Not OpenAPI/FastMCP codegen; not one-tool-per-endpoint; not a release green light until packaging + Postgres residuals close.
