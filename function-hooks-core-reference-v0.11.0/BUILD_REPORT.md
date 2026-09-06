# Function Hooks Core Reference — v0.11.0 Build Report

Version: `0.11.0`  
Semantic contract: `1.0-rc.1`  
Semantic fingerprint: `aef14d3c4b77d9874496d0d020241ec976b9b038c8d2274c1e0c6bfd1939c708`

## Release objective

v0.11.0 implements the first automatic-capability layer above the already hardened gateway/router. The kernel is unchanged. Discovery output is now a non-authoritative candidate; a separate admission step creates hash-bound evidence; only active admitted capabilities can be projected to the agent catalog or compiled into executable routes.

## New trust boundary

- `CapabilityCandidate`: immutable discovery evidence only; cannot be registered or routed.
- `AdmittedCapability`: exact candidate + admission ID/policy version + bound hashes.
- `InMemoryCapabilityRegistry`: explicit active/suspended/revoked/superseded lifecycle. Terminal states cannot be reactivated.
- `CapabilityRegistryPersistence`: persistence contract for later durable registry implementations.
- Agent catalog projection exposes semantic ID, description, schemas, risk/sensitivity/side-effect labels, and schema hash, but not implementation endpoints/tool names/process profiles or admission internals.
- Router compilation supports admitted MCP, HTTP, browser, desktop, process-profile, file-read, and file-write capabilities. Generated admission metadata is trusted-side and cannot be overwritten by request metadata.
- Manual routes remain supported for mappings that need custom code.

## Qualification

The release must pass the frozen kernel conformance suites, cross-runtime differential campaign, all existing v0.10 hardening tests, the new capability/registry tests, all demos, API/semantic snapshots, package-boundary gates, packed-consumer offline installation, clean-checkout rebuild, whole-tree manifest verification, and qualification from the exact extracted ZIP. Final counts are recorded in `RELEASE_EVIDENCE.json`.

## Evidence boundary

The v0.11 registry is in-memory. `CapabilityRegistryPersistence` is an interface, not a claim of crash-durable or distributed registry state. `admitCapability()` hash-binds policy metadata to a candidate but does not cryptographically authenticate an approver. Router compilation is a snapshot of currently active registry records; live revocation propagation, connector discovery, schema-drift quarantine, signed admission, and durable registry backends remain future work. Existing v0.10 filesystem/process/network boundaries retain their documented limitations.

## Completed release gates

- Clean source checkout with generated outputs/workspace links removed: build completed and post-build architecture/API/semantics checks, 17/17 reference tests, 2/2 portable tests, 91/91 top-level entries, and all 11 demos passed.
- 14 npm tarballs (13 scoped packages plus umbrella) dry-pack successfully.
- Fresh offline scoped install: both packed runtimes 21/21 plus capability-registry/router smoke PASS.
- Fresh offline umbrella install: stable root exposes capability/router API while compatibility stays isolated to `/compat`.
- Exact final ZIP manifest/requalification are performed after archive sealing.
