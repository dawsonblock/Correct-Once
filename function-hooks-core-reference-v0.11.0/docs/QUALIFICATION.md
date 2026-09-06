# Qualification — v0.11.0

The kernel remains frozen at `1.0-rc.1` with SHA-256 `aef14d3c4b77d9874496d0d020241ec976b9b038c8d2274c1e0c6bfd1939c708`. v0.11.0 adds only higher-layer capability admission/registry/routing behavior; all v0.10 host hardening remains in force.

## New v0.10 gates

1. Separate `FileActionReceiptStore` instances and independent Node processes contend on one journal; exactly one same-ID claim wins.
2. Separate `DurableAuditJournal` instances and independent Node processes append to one file without sequence/hash-chain forks.
3. A stale same-host lock owned by a nonexistent PID is recovered without waiting for the remote stale timeout.
4. A timed-out process that creates a grandchild is terminated as a POSIX process group; the grandchild cannot perform its delayed side effect.
5. Linux secure filesystem mode performs descriptor-anchored reads/writes, rejects symlink targets, and enforces byte caps.
6. An allowlisted loopback/private HTTP destination is still rejected by default after address resolution; explicit private-address opt-in is required for local/test traffic.
7. Existing reference/portable conformance, differential, gateway/router, isolation, replay, audit, receipt, API snapshot, package-boundary, and demo gates remain mandatory.

## Non-claims

- Lock files are not distributed consensus or a multi-host transactional database.
- Process groups are not a hostile-code sandbox and can be escaped by sufficiently privileged/deliberately daemonizing code; use the isolation package/container boundary for that threat model.
- Descriptor anchoring is Linux-specific and not equivalent to `openat2(RESOLVE_BENEATH)` on every platform.
- `networkAllowPrivateAddresses: true` intentionally disables the private-address SSRF barrier for explicitly trusted/local deployments.

## v0.11 capability gates

Qualification additionally checks deterministic schema/descriptor/candidate fingerprints, cross-connector identity behavior, raw-candidate rejection, hash-bound admission evidence, registry terminal states, active-only agent catalog projection, generated routes, trusted admission provenance, manual-route coexistence, and structured HTTP compilation.

## v0.11 observed counts

- reference kernel tests: 17/17
- portable runtime tests: 2/2
- top-level compiled test entries: 91/91 across 13 isolated test-file processes
- total Node test entries: 110/110
- capability/registry additions: 10/10
- public conformance: 21/21 on each runtime
- differential campaign: 768/768 equivalent dispatches
- executable demos: 11/11
- API declaration snapshots: 14/14
