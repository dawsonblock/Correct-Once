# Donor provenance and adoption policy

The source archive used to design Effect Fabric v0.2 contained five independent repositories:

| Donor | Role adopted | Source/derived material shipped? |
|---|---|---|
| durable-agent-outbox | durable-effect semantics and conformance | **Yes, one MIT-derived compatibility reducer** |
| OpenOnce | provider-profile semantics | No |
| AgentAction | authorization interoperability | No |
| PALOframework | contract/verifier vocabulary | No |
| ChronoMCP | compensation metadata compatibility | No |

`bridges/durable-agent-outbox/effect_fabric_native_reduce.ts` is a checked-in compatibility
implementation derived from `durable-agent-outbox/packages/core/src/reduce.ts`. It retains an SPDX
MIT identifier and is distributed with the donor copyright/license notice in
`LICENSES/durable-agent-outbox-MIT.txt` and `THIRD_PARTY_NOTICES.md`.

Qualification may derive a temporary scheduler from the exact locked donor `worker.ts`; that
transformed scheduler exists only in the qualification workspace and is not bundled as donor source.
No complete donor source tree is bundled into the Effect Fabric wheel or source release.

`DONOR_LOCK.json` records the analyzed donor tree/package fingerprints used by the offline conformance
bridge. A future release should replace archive-only provenance with immutable upstream commit SHAs,
repository URLs, and automated SBOM/license capture.
