# @function-hooks/capabilities

Canonical capability descriptors and the trust boundary between discovery and routing.

A `CapabilityCandidate` is discovery evidence only. It has **zero execution authority**. `admitCapability()` produces an `AdmittedCapability` with hash-bound admission evidence. Only admitted capabilities can enter a `CapabilityRegistry`, and routers should compile routes only from active registry entries.

The package provides deterministic schema/descriptor/candidate fingerprints, an in-memory active/suspended/revoked/superseded registry, a persistence interface for future durable backends, and a safe agent-catalog projection that deliberately omits backend implementation details.

Admission hashes are integrity evidence, not authenticated signatures. The v0.11 registry is in-memory and router construction is snapshot-based.
