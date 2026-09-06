# Effect Fabric DAO Store Compatibility Adapter

`effect_fabric.qualification.dao_store.DaoSqliteStoreAdapter` is a qualification implementation of
the durable-agent-outbox `OutboxStore` behavioral contract.

It is intentionally donor-shaped JSON storage rather than a translation into `EffectTransaction`.
This keeps the conformance question narrow: can Effect Fabric provide the donor's required CAS and
action+audit atomicity semantics without copying the donor runtime?

## Durability choices

- Python stdlib `sqlite3`;
- WAL journal mode;
- `synchronous=FULL`;
- `BEGIN IMMEDIATE` for commits;
- unique action id and idempotency key;
- globally unique monotonic audit sequence;
- action write and audit append in one SQLite transaction;
- revision mismatch returns `False` without mutation;
- malformed/reused audit sequence raises a hard store error and rolls back the entire transaction.

## Scope

The adapter is used only by qualification tooling. Production Effect Fabric deployments should use
the production store interfaces and PostgreSQL qualification gates. Passing this adapter gate does
not establish multi-process PostgreSQL behavior or make remote provider calls transactional.
