# Capability discovery/admission model — v0.11.0

The v0.11 trust rule is simple: **discovery is not authority**.

```text
connector/discovery -> CapabilityCandidate -> trusted admission -> AdmittedCapability -> registry(active) -> Router -> Gateway
```

`CapabilityCandidate` records include semantic identity, schemas, side-effect/sensitivity/risk labels, provenance, and a structured implementation descriptor. `schemaHash` covers input/output schemas. `descriptorHash` covers the semantic contract and implementation. `candidateHash` additionally binds connector identity/version/source digest while intentionally excluding rediscovery timestamps.

`admitCapability()` validates a candidate and attaches admission evidence. This evidence is integrity binding, not a digital signature. A raw candidate cannot be registered by `InMemoryCapabilityRegistry` and `compileAdmittedCapabilityRoute()` rejects it at runtime.

Active registry records can be projected two ways from the same source of truth:

- agent catalog: semantic information only; backend implementation/provenance/admission details omitted;
- execution router: trusted structured backend mapping plus admission metadata.

The v0.11 router snapshot is constructed from active records at creation time. Suspending/revoking a capability after router creation does not mutate an existing router; reconstruct/refresh behavior is a later release gate.
