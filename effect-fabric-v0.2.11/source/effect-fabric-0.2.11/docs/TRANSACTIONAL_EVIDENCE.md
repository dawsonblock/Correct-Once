# Transactional Evidence — v0.1.5

v0.1.5 closes the v0.1.4 gap where a security-critical state transition could commit and the
process could die before the corresponding evidence event was persisted.

## Guarantee

For transitions routed through the store, Effect Fabric commits the domain-state mutation and an
`EvidenceIntent` row in the same store transaction. The intent is not yet the final hash-chain
event; it is a durable obligation to materialize one.

```text
state transition
      +
evidence intent
      |
      +-- one atomic DB commit
              |
              v
       transactional outbox
              |
              v
        evidence dispatcher
              |
              v
         hash-chain event
```

If the process dies after the database commit but before dispatch, the outbox item remains pending.
If it dies after the ledger append but before acknowledging the outbox item, redelivery uses the
outbox UUID as an idempotency key and returns the already-materialized event instead of extending the
chain twice.

## Atomic transitions

The v0.1.5 engine couples evidence intent with:

- transaction proposal;
- preparation;
- authorization replacement;
- capability consumption and `STARTED`;
- provider success/failure/unknown finalization;
- orphan fencing to `UNKNOWN`;
- reconciliation state changes;
- verification start and final attestation.

Observation-only events such as an inconclusive reconciliation are inserted into the outbox as their
own durable store transaction because there is no domain-state mutation to couple them with.

## Delivery model

Delivery is deliberately at-least-once. The hash-chain sink must enforce one event per
`source_outbox_id`. This is stronger and more honest than claiming exactly-once delivery across two
independent persistence boundaries.

Outbox claims have leases. A dead dispatcher can be replaced after lease expiry. Sink errors return
the item to `pending`. A process death after sink append deliberately leaves the row claimed; once the
lease expires, another dispatcher safely replays it.

## PostgreSQL

`effect_evidence_outbox` is stored in PostgreSQL with `FOR UPDATE SKIP LOCKED` claim semantics.
`effect_events.source_outbox_id` has a unique index so replay cannot create a second evidence event.
PostgreSQL CI includes OS-process-kill cases for:

1. process death immediately after `STARTED + outbox` commit, before provider execution; and
2. process death after evidence append but before outbox acknowledgement.

These tests are shipped but are only locally qualified where PostgreSQL and `psycopg` are available.

## Non-guarantees

v0.1.5 does not make the external provider action atomic with the local database. Provider ambiguity
still uses the `UNKNOWN -> reconcile` protocol. It also does not make external WORM anchoring atomic
with the evidence ledger, and it does not claim distributed exactly-once execution.
