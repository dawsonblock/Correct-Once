# MCP Hooks Upgraded v0.1.1 Freeze Notes

## Scope

This repository snapshot is a **freeze only** for `mcp-hooks-upgraded` version
`0.1.1`. It documents the locked execution contract and records the adapter
landing area without vendoring the full upstream dependency trees.

## Frozen pins

| Component | Version |
| --- | --- |
| `effect-fabric` | `0.2.11` |
| `function-hooks-core-reference` | `0.11.0` |
| `adapter` | `0.1.1` |

## Execution and safety contract

- **B admits / A executes**.
- Only curated tools are allowed:
  `search_capabilities` and `invoke_capability`.
- `createEffectLockedAgentGateway` enforces a composition lock via a
  **module-private `Symbol`**.
- The lock is always asserted **before** `createAgentGateway`.
- Destructive behavior is **OFF by default**.
- Smoke validation uses **mirrored gates**, not a live `effect_fabric`.

## Repository contents in this freeze

- `README.md` — modern freeze overview and critical-path code snippet.
- `mcp-hooks-upgraded-v0.1.1.sha256` — exact checksum record for the release
  bundle.
- `adapter/` — adapter `0.1.1` landing area in git.

## Intentionally not vendored

The full `effect-fabric` and `function-hooks-core-reference` source trees are
not stored in this git repository. The canonical full bundle for this freeze is
the release asset below.

## Release asset integrity

- File: `mcp-hooks-upgraded-v0.1.1.zip`
- SHA256:
  `d9b4292e6b2cb1d1314e2d1a4edf16db423a2248e7d9201393e0a1027d1eef8f`

Exact checksum line:

```text
d9b4292e6b2cb1d1314e2d1a4edf16db423a2248e7d9201393e0a1027d1eef8f  mcp-hooks-upgraded-v0.1.1.zip
```
