# Correct-Once live gateway (host path, BLOCK RELEASE)

This directory contains the **permanent host-path gateway service** for Correct-Once:

- **Effect Fabric 0.2.12** remains the governed execution layer.
- A **live MCP transport** sits below it.
- A **runtime snapshot with admit-time execution pins** stays authoritative.

This is **not** a packaging or production-release claim. It remains **BLOCK RELEASE**
and does **not** mint `RELEASE_QUALIFIED`.

## What it does

- loads a runtime capability snapshot from `EFFECT_GATEWAY_SNAPSHOT_PATH`
- registers only MCP capabilities pinned for the gateway path:
  - `executionClass=read, executor=fast`
  - `executionClass=critical, executor=effect`
- re-checks the authoritative snapshot on every effect authorization via
  `LiveAuthorityPolicy`
- talks to a real MCP server over **stdio JSON-RPC**
- exposes the authenticated HTTP facade from `effect_fabric.gateway_api`

Unknown MCP tools stay denied. The gateway does **not** enable
`allow_unregistered_reads`.

## Required environment

```bash
export PYTHONPATH="$PWD:$PWD/effect-fabric-v0.2.12/source/effect-fabric-0.2.12/src"
export EFFECT_GATEWAY_SNAPSHOT_PATH=/absolute/path/to/runtime-snapshot.json
export EFFECT_GATEWAY_TOKEN=replace-me
export EFFECT_GATEWAY_MCP_TRANSPORT=stdio
export EFFECT_GATEWAY_MCP_SERVER_NAME=github
export EFFECT_GATEWAY_MCP_COMMAND=node
export EFFECT_GATEWAY_MCP_ARGS_JSON='["/absolute/path/to/server.mjs"]'
```

Optional knobs:

- `PORT` or `EFFECT_GATEWAY_PORT` (default `8000`)
- `EFFECT_GATEWAY_HOST` (default `0.0.0.0`)
- `EFFECT_GATEWAY_APPROVAL_REQUIRED_OPERATIONS=app.capability,...`
- `EFFECT_GATEWAY_APPROVAL_SECRET=...`
- `EFFECT_GATEWAY_MCP_CWD=/absolute/path`
- `EFFECT_GATEWAY_MCP_ENV_JSON='{"KEY":"VALUE"}'`
- `EFFECT_GATEWAY_MCP_REQUEST_TIMEOUT_SECONDS=15`
- `EFFECT_GATEWAY_MCP_STARTUP_TIMEOUT_SECONDS=15`

## Run

```bash
python3 -m correct_once_gateway.main
```

Health:

```bash
curl http://127.0.0.1:${PORT:-8000}/healthz
```

Authenticated tool call:

```bash
curl \
  -H "authorization: Bearer $EFFECT_GATEWAY_TOKEN" \
  -H "content-type: application/json" \
  -d '{"subject":"tenant-a","server":"github","tool":"repo.settings","arguments":{"repo":"acme/example","mode":"strict"}}' \
  http://127.0.0.1:${PORT:-8000}/gateway/tool-call
```

## Honesty boundary

This folder proves the **live gateway authority path** and ships a working stdio
connector. It does **not** claim:

- production packaging is green
- Postgres durability residuals are closed
- deployment infrastructure is qualified
- unknown MCP tools are safe to auto-admit
