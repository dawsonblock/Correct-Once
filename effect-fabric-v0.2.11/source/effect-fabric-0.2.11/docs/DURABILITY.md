# Durability and Crash Semantics

## STARTED means external execution may be in flight

Before provider I/O, Effect Fabric atomically consumes the exact active capability, increments the
transaction fencing epoch, persists `STARTED`, and creates an execution attempt with a lease.

An attempt contains:

- `attempt_id`
- `transaction_id`
- `executor`
- `fencing_epoch`
- `lease_owner`
- `lease_expires_at`
- terminal/recovery state

## Process death after STARTED

A process death is not interpreted as provider failure. Once the lease expires, a recovery worker
may call `recover_orphaned_started()`.

The store transaction:

1. locks the transaction and current attempt;
2. verifies the transaction is still `STARTED` and the attempt lease expired;
3. increments `fencing_epoch`;
4. marks the transaction `UNKNOWN`;
5. marks the attempt `ORPHANED`.

The fence increment is critical. A delayed old worker still holding the prior epoch cannot write a
receipt or failure after the recovery worker has taken ownership.

## Reconciliation

`UNKNOWN` requires provider-specific reconciliation:

- `HAPPENED` -> execution state `RECONCILED`, then independent verification;
- `NOT_HAPPENED` -> may return to `PREPARED` only when the idempotency contract explicitly permits
  retry after a proven no-effect result;
- `UNKNOWN` -> remain `UNKNOWN`; no automatic retry.

A reconciled effect deliberately does not fabricate an original provider receipt.

## Exceptions

Typed provider errors state whether the effect may have happened. Any unclassified exception is
conservatively treated as potentially post-effect and moves the transaction to `UNKNOWN`.

## Still required for production qualification

- real process-kill tests against PostgreSQL at every durable boundary;
- multi-process rather than only async-task contention;
- database failover/connection-loss tests;
- provider-specific reconciliation under eventual consistency;
- durable evidence storage atomically coordinated with state transitions.
