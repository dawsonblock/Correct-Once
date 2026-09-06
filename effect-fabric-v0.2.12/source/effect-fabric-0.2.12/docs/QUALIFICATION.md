# Qualification Plan

A release is qualified by evidence, not by feature count.

## G0 — Protocol

- deterministic canonicalization and float rejection
- action/contract changes alter the digest
- capability signature binds transaction identity and all security-relevant fields

## G1 — Authorization

- same-digest cross-transaction substitution rejected
- only the current active grant can start execution
- replacement authorization revokes the prior grant
- authorization registration + active-capability pointer update are one atomic store transition
- expired, consumed, revoked, tampered, stale-policy, and wrong-executor grants fail

## G2 — Durability and fencing

- capability consumption + `STARTED` + attempt creation are atomic before provider I/O
- each attempt has a finite lease and fencing epoch
- an unexpired attempt cannot be orphan-recovered
- expired `STARTED` recovery increments the fence before `UNKNOWN`
- a late worker with the old fence cannot write
- parallel consumption yields one winner
- crash after provider effect but before receipt persistence reconciles without a second effect
- unclassified execution exceptions fail closed to `UNKNOWN`

The local reference suite covers these semantics in memory. PostgreSQL CI covers the same contracts
when psycopg/PostgreSQL are available. This archive build does not claim a local live-Postgres pass.

## G3 — Provider correctness

Deterministic local HTTP qualification must prove:

- success -> receipt -> independent verification
- mutation then response loss -> `UNKNOWN` -> `HAPPENED` -> `RECONCILED`
- response loss before mutation -> `UNKNOWN` -> `NOT_HAPPENED` -> `PREPARED`
- provider-proven pre-effect outage/rate limit -> retryable but fresh authorization required
- definitive rejection -> terminal execution failure, not blind retry
- protocol violation after mutation -> `UNKNOWN`, not definitive failure
- reconciliation outage -> remain `UNKNOWN`
- eventual consistency -> bounded observation retries
- verifier outage -> bounded exhaustion -> `INCONCLUSIVE`
- third-party drift -> `MISMATCH`

Real-provider gates remain separate because the local qualification server only proves Effect
Fabric's interpretation logic.

## G4 — Independent verification

- provider success but wrong state -> `MISMATCH`
- typed transient verifier failure may retry only within the contract budget
- verifier outage after the budget -> `INCONCLUSIVE`
- reconciliation success -> `RECONCILED`, followed by independent verifier observation

## G5 — Recovery

- compensation generated as a new `ActionIntent`
- recovery receives fresh authorization/idempotency/verification
- provider recovery response alone cannot prove restoration

## G6 — Evidence

- hash-chain mutation detection
- signed-root verification
- production gate remains open until roots are durably anchored outside the primary trust domain

## G7 — API/MCP

- transaction API absent by default and authenticated/redacted when enabled
- unknown mutating MCP tool denied

## G8 — Counterfactual execution

- sandbox lacks production credentials/network authority
- candidates produce proposals only
- production state is re-read before real authorization


## Evidence qualification — v0.1.4

Run `PYTHONPATH=src python scripts/qualify_evidence.py`. The local suite must prove restart
integrity, historical tamper detection, external anchor persistence, chained-anchor validation,
key rotation, anchored-prefix validation, suffix-deletion detection, and key-ID rebind rejection.

A passing local file-based qualification does not qualify PostgreSQL or WORM storage. PostgreSQL
evidence serialization is a separate CI/live gate, and production anchoring requires an
independently administered immutable destination.

## G6b — Transactional evidence — v0.1.5

Run `PYTHONPATH=src python scripts/qualify_transactional_evidence.py`.

The local qualification must prove:

- a committed `STARTED` transition retains a pending evidence intent if the process dies before
  ledger materialization;
- a replacement dispatcher can materialize that pending intent later;
- the ledger deduplicates repeated delivery of the same outbox UUID;
- a crash after ledger append but before outbox acknowledgement does not extend the chain twice;
- file-ledger restart preserves the outbox identity used for deduplication;
- sink failure returns a claimed item to pending rather than losing it.

The PostgreSQL CI module adds actual OS-process death after `STARTED + outbox` commit and after
ledger append/before outbox acknowledgement. A local run without PostgreSQL must report those tests
as skipped/NOT_RUN rather than extrapolating from the in-memory qualification.

## G9 — PostgreSQL and release qualification — v0.1.6

The v0.1.6 release job treats PostgreSQL and static quality as explicit gates rather than implied
properties of the reference suite.

Required PostgreSQL scenarios include:

- independent-connection capability consumption races;
- atomic `STARTED + attempt + evidence intent` behavior;
- transaction rollback leaves no partial outbox/state transition;
- competing dispatchers claim distinct rows with `FOR UPDATE SKIP LOCKED`;
- evidence-chain serialization across independent connections;
- process death after `STARTED + outbox` commit;
- process death after ledger append and before outbox acknowledgement;
- stale fencing epochs cannot finalize replacement-worker state.

Run `PYTHONPATH=src python scripts/qualify_postgres.py` with
`EFFECT_FABRIC_TEST_POSTGRES_DSN` configured. A release environment that lacks the dependency or
service must produce `NOT_RUN`; it must not promote the gate to PASS.

Static release qualification requires Ruff and mypy to pass in the release CI environment. Local
runs may use `scripts/qualify_static.py --allow-not-run` only to record that unavailable binaries
were not executed.

Stable qualification result files intentionally omit timestamps. Runtime metadata is captured once
in `QUALIFICATION_RUN.json` and is excluded from the source hash manifest. `MANIFEST.sha256` is
generated only after stable qualification results are finalized.
