# Isolation Architecture — v0.3.0

> Historical baseline: this document describes the v0.3-era design. The current distribution is v0.11.0; current gateway/release evidence is in `AGENT_GATEWAY.md`, `QUALIFICATION.md`, and `BUILD_REPORT.md`.


## RPC model

The child receives immutable event data and dispatch metadata. Calls to `$` and `next` are serialized to the host. The host owns plugin identity, validates event schemas/budgets, applies all hook chains, and invokes trusted adapters.

## Capability grants

Each isolated plugin gets a normalized grant set. Default: empty.

Supported patterns:

- `ui.log` — one exact event;
- `fs.*` — every event under a noun;
- `*` — all engine events.

The child proxy hides denied nouns/events. The host independently checks every engine RPC; the child cannot gain authority by forging protocol messages.

## Local Node permission profile

Controls include:

- separate process;
- Node permission mode;
- plugin-root and runtime-root read permissions only;
- restrictive ESM loader;
- plugin import confinement by realpath;
- ambient Node builtin import denial;
- no global module search paths;
- native addons disabled;
- ambient `process`, `fetch`, `WebSocket`, and `EventSource` removed from plugin global scope;
- bounded memory and protocol frames;
- kill-on-timeout.

## Podman profile

`PodmanIsolationLoader` uses the same RPC worker and adds an OS/container boundary with a default plan containing:

- no network;
- read-only root filesystem;
- all Linux capabilities dropped;
- no-new-privileges;
- CPU/memory/PID limits;
- read-only runtime/plugin mounts;
- small restricted tmpfs;
- Node permission mode inside the container.

The host still performs capability and dispatch enforcement; the container boundary is defense in depth, not a replacement for the authority plane.

## Remaining risk

Node, container runtime, kernel, seccomp profile, LSM configuration, and host setup remain part of the trusted computing base. The packaged test suite validates command-plan construction but does not execute Podman in CI.
