# Reducer Equivalence Qualification

v0.2.5 does not replace the active `EffectEngine`. Instead it runs the active in-memory runtime and
the candidate pure reducer through equivalent semantic traces and compares the execution-state
projection.

Current traces cover:

1. `PLANNED -> PREPARED`;
2. `PREPARED -> AUTHORIZED`;
3. durable `STARTED` before provider I/O;
4. successful provider receipt;
5. ambiguous provider outcome -> `UNKNOWN/IN_DOUBT`;
6. authoritative `HAPPENED/LANDED` reconciliation;
7. authoritative `NOT_HAPPENED/NOT_LANDED` -> `PREPARED` + fresh authorization;
8. proven pre-effect retryable provider failure;
9. proven definitive provider failure;
10. orphan recovery with monotonic fencing-epoch advancement.

The state projection is:

```text
Runtime                    Pure reducer
PLANNED                    PLANNED
PREPARED                   PREPARED
AUTHORIZED                 AUTHORIZED
STARTED                    STARTED
UNKNOWN                    IN_DOUBT
RECEIPT_RECORDED           RECEIPT_RECORDED
RECONCILED                 RECONCILED
EXECUTION_FAILED           EXECUTION_FAILED
```

This gate is intentionally narrower than full implementation equivalence. It does not cover public
withdrawal/supersession commands because the active runtime does not yet expose them, nor does it
replace live PostgreSQL, provider, or upstream donor qualification.

A pass therefore means: **the candidate reducer makes the same common lifecycle decisions as the
current runtime for the qualified traces.** It does not mean the reducer is promoted.
