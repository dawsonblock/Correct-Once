# Roadmap Beyond v0.11.0

## Completed through v0.11.0

- minimal frozen kernel and independent higher-layer package DAG;
- compatibility runtime quarantined outside the umbrella root;
- two independently implemented runtimes with frozen 21-case `1.0-rc.1` semantics;
- declaration/API snapshots and deterministic 256-chain / 768-dispatch differential qualification;
- fail-closed action gateway with receipts, audit, capability process profiles, and hardened Node adapters;
- atomic same-instance and cooperating cross-process file-journal receipt/audit coordination;
- reusable `@function-hooks/router` so apps are `(app, capability)` configuration instead of bespoke gateway integrations;
- canonical capability candidates/admission evidence, registry lifecycle, safe agent-catalog projection, and automatic route compilation from active admitted capabilities;
- standardized MCP, API, browser, desktop, and local execution backend classes;
- abstract `desktop.call` event with application-scoped policy allowlisting;
- process-group descendant cleanup, descriptor-anchored Linux filesystem I/O, DNS/IP-pinned HTTP(S) egress, and offline package/clean-ZIP qualification workflow.

## Immediate higher-layer gates

1. Add authenticated `GatewayAuthority` context separate from diagnostic kernel `origin`.
2. Replace boolean approvals with action-hash-bound, expiring approval grants.
3. Introduce receipt-v2 state transitions and PostgreSQL compare-and-swap storage for multi-host/distributed use; file locks remain a single-filesystem mechanism.
4. Add indeterminate-action reconciliation/operator workflows.
5. Harden general network execution with DNS/IP range policy and connection pinning.
6. Add secret references/brokered injection so credentials do not enter model-visible action payloads or ordinary audit records.
7. Run live rootless Podman hostile-code qualification and introduce explicit execution isolation tiers.
8. Add MCP connector discovery + schema normalization/fingerprinting, deterministic admission policy, and changed-schema quarantine.
9. Add live registry-to-router refresh/revocation propagation and catalog retrieval for large capability sets.

## Remaining 1.0 kernel/release gates

- actual non-Node execution of `@function-hooks/portable` if portability is claimed;
- public-registry publication/install CI with provenance;
- RC window with the semantic fingerprint unchanged;
- explicit decision on `/compat` in the 1.0 umbrella.
