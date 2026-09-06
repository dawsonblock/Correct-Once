# Upstream durable-agent-outbox Bridge

Effect Fabric can execute several gates against the exact donor source locked by `DONOR_LOCK.json`.
The donor checkout is intentionally external to the release bundle.

## Reference and negative controls

`scripts/qualify_upstream_dao.py` compiles the locked donor `core` and `conformance` packages offline
with local `tsc`, then calls the donor public conformance API and mutants.

## Effect Fabric compatibility layers

The same locked scenario suite can be exercised through:

- `DaoSqliteStoreAdapter`;
- the structural `OutboxEngine` wrapper;
- `EffectFabricActiveScheduler` + pre-commit guard;
- `EffectFabricNativeScheduler` + checked-in Effect Fabric native transition reducer + pre-commit
  guard + SQLite CAS store + post-operation shadow.

The native path poisons the compiled donor `reduce()` implementation so accidental transition-oracle
fallback fails immediately.

If `EFFECT_FABRIC_DAO_DONOR_ROOT` is not supplied to `scripts/qualify.sh`, these upstream reports are
freshly marked `NOT_RUN` and provenance-bound to the current source. A historical PASS file is never
implicitly reused.

## What is still not qualified by this bridge

The bridge does not prove that the production `EffectEngine` implements the DAO scheduler state model
or that PostgreSQL/process-failure behavior is equivalent to the SQLite compatibility store.
Production qualification still requires real PostgreSQL, multiple processes, connection loss,
process kills, and stale-worker races.
