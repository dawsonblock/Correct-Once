# Transition Kernel Promotion Gates

The DAO compatibility reducer is not yet the production `EffectEngine` execution kernel.

## Completed

- Pure reducer side-effect scan.
- Internal 17-scenario semantic conformance port.
- Internal negative-control discrimination.
- Active-runtime/common-trace equivalence qualification.
- Exact locked durable-agent-outbox core/conformance compilation.
- Official upstream reference and mutant gates when the locked donor source is supplied.
- Official upstream suite against Effect Fabric SQLite compatibility storage.
- Active scheduler + pre-commit invariant guard.
- Donor `OutboxWorker` concrete class removed from the newest path.
- Donor pure `reduce()` transition oracle replaced in the newest path by the checked-in Effect Fabric
  native compatibility reducer.
- Donor reducer poisoning to detect accidental fallback.
- Qualification-input/source binding for all stable PASS evidence.

## Still required before production-kernel promotion

1. Define a canonical transition algebra covering the production capability/fencing/evidence model,
   not just DAO compatibility states.
2. Mechanically prove or test mappings from that algebra into the Python runtime and TypeScript DAO
   compatibility boundary.
3. Run direct production PostgreSQL qualification with independent processes/connections.
4. Kill workers around every durable boundary and verify restart/takeover truthfulness.
5. Prove stale fencing epochs cannot finalize after takeover under real PostgreSQL races.
6. Qualify provider-specific reconciliation under real connection loss/eventual consistency.
7. Preserve transactional-evidence and signed-anchor invariants through any kernel promotion.
8. Close production identity, key custody, and independently administered anchor gates.

Until those gates are complete, the production `EffectEngine` remains authoritative.
