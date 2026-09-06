# PostgreSQL Crash and Fencing Matrix — v0.2.9

This document defines the live PostgreSQL qualification boundary for Effect Fabric v0.2.9. The
matrix is intentionally stronger than exception-injection tests: crash cases use a separate Python
process and `os._exit()` after a durable boundary so interpreter cleanup cannot make an unsafe state
look clean.

## Safety model

A worker owns an execution attempt only while all of the following identify the same attempt:

- transaction ID;
- attempt ID;
- transaction fencing epoch;
- attempt fencing epoch;
- attempt lease owner;
- active attempt state.

Learning a newer transaction fencing epoch is not sufficient for an old attempt to finalize. After
orphan recovery, reconciliation is a separate operation authorized by the transaction's current
fence and may settle an `UNKNOWN` or `ORPHANED` historical attempt.

Evidence outbox ownership is similarly instance-specific. `claim_owner` is descriptive identity;
`claim_token` is the actual per-claim fencing credential. Every reclaim receives a new token, even
when the same logical worker ID is reused.

## Crash points

| ID | Boundary | Expected durable result | Required recovery |
|---|---|---|---|
| P0 | Process dies before STARTED transaction | `AUTHORIZED`; no attempt/effect | Safe to start later with valid capability |
| P1 | STARTED + attempt + evidence intent committed, then process dies | `STARTED`; active attempt; pending evidence | Wait for lease expiry, fence orphan to `UNKNOWN`, reconcile |
| P2 | External effect durably happened, response/receipt not persisted, then process dies | `STARTED`; external marker may exist | Orphan recovery to `UNKNOWN`; never blind retry |
| P3 | Provider classified ambiguity and `UNKNOWN` committed | `UNKNOWN`; attempt `UNKNOWN` | Reconcile |
| P4 | Receipt + successful attempt + evidence intent committed, then process dies | `RECEIPT_RECORDED`; pending evidence | Resume verification/evidence dispatch; never re-execute |
| P5 | Outbox row claimed, process dies before ledger append | claimed row with expiring token | Reclaim after expiry with a new token |
| P6 | Ledger append committed, process dies before outbox ACK | one ledger event; claimed outbox row | Reclaim and idempotently resolve same `source_outbox_id` |
| P7 | Orphan takeover increments fence while old worker is delayed | transaction has newer fence | Any old attempt finalization must fail |
| P8 | Reconciliation settles orphan/unknown attempt | current-fence transaction transition + attempt `RECONCILED` | Continue from reconciled state |

The current executable process-kill helper covers P1, P2, P4, P5, and P6. P3 is covered by the
normal provider ambiguity suite; P7/P8 are covered by explicit live fencing tests. P0 is structurally
safe because capability consumption, attempt creation, fencing increment, `STARTED`, and evidence
intent are committed atomically; no provider I/O occurs before that transaction returns.

## Database-level guards

Migration `006_postgres_fencing_claim_tokens.sql` adds two independent safeguards:

1. `one_active_attempt_per_transaction`, a partial unique index preventing two active attempts for
   one transaction even if application-level ownership logic regresses.
2. `claim_token`, a per-claim UUID used to fence stale evidence-dispatcher instances.

Application code additionally verifies attempt fencing epoch, attempt owner, and active attempt state
before normal attempt completion.

## Required live scenarios

`python scripts/qualify_postgres.py` runs both PostgreSQL suites and refuses PASS when any live test is
skipped. The required scenario set includes:

- parallel capability consumption has exactly one winner;
- at most one active attempt exists at the database level;
- expired STARTED attempt takeover increments the fence;
- an orphaned attempt cannot finalize by supplying the new epoch;
- orphan reconciliation is allowed only through the dedicated reconciliation transition;
- reused logical dispatcher IDs cannot ACK using a superseded claim token;
- SIGKILL after STARTED commit preserves state and evidence intent;
- SIGKILL after a separately committed external-effect marker leaves an ambiguous STARTED state;
- SIGKILL after receipt commit preserves receipt and evidence intent;
- SIGKILL after outbox claim permits later reclaim with a different token;
- SIGKILL after ledger append permits redelivery without a second ledger event.

## Running the gate

```bash
export EFFECT_FABRIC_TEST_POSTGRES_DSN='postgresql://...'
PYTHONPATH=src python scripts/qualify_postgres.py --output POSTGRES_QUALIFICATION.json
```

A PASS is valid only when a real DSN is supplied, the PostgreSQL driver is installed, both suites
execute, no tests are skipped, and the pytest return code is zero. Without those conditions the
gate is `NOT_RUN` or `FAIL`; the release tooling does not infer success from local/in-memory tests.
