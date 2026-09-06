# Security Boundary Summary — v0.3.0

> Historical baseline: this document describes the v0.3-era design. The current distribution is v0.11.0; current gateway/release evidence is in `AGENT_GATEWAY.md`, `QUALIFICATION.md`, and `BUILD_REPORT.md`.


## Strongest invariant

The system is only an execution-authority architecture when plugin code cannot reach privileged resources except through the engine interface `$` or another explicitly trusted channel.

## Defense layers

1. **Admission** — sealed managed configuration and exact plugin digest pins before candidate code execution.
2. **Order** — deterministic prepend/dependency/append ordering; earlier placement is treated as greater authority.
3. **Engine shape** — `engine.create` is bootstrap-trusted; isolated plugins cannot register it.
4. **Capability grants** — isolated `$` is deny-by-default; only explicitly granted events appear and host RPC re-checks them.
5. **Isolation** — local Node permission-process profile plus optional stronger launch builder; Podman profile ships with network/rootfs/capability restrictions.
6. **Dispatch validation** — immutable rewritten events are schema-validated at each continuation boundary, with deadline/size/multiplicity limits.
7. **Side-effect replay control** — durable action receipts prevent automatic duplicate execution after completed or indeterminate attempts.
8. **Evidence** — hash-chain/HMAC audit, durable fsync journal, replay records, and activation receipts.
9. **Lifecycle** — candidate generation starts and health-checks before atomic publication; old generations drain existing leases.

## Important non-claims

`NodePermissionProcessLoader` is not a hostile-code sandbox equivalent to a microVM. `PodmanIsolationLoader` creates a materially stronger OS/container boundary, but this package does not claim universal container escape resistance or host-policy correctness.

Exactly-once receipt semantics are **exactly-once-or-detect**. An indeterminate external effect is intentionally not retried automatically.

`TrustedInProcessLoader` remains for trusted development code only and is not a security boundary.
