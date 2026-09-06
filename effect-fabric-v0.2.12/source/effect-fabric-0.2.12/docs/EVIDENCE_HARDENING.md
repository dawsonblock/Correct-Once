> **Historical note (superseded):** The v0.1.4 state/evidence atomicity gap described below was closed by the v0.1.5 transactional evidence outbox. This document remains for release history.

# Evidence Hardening — v0.1.4

Effect Fabric distinguishes three evidence properties that are often incorrectly collapsed:

1. **event integrity** — historical event mutation breaks the hash chain;
2. **event durability** — events survive process restart;
3. **external anchoring** — a proof outside the ledger store detects local suffix deletion.

## Local reference ledger

`FileHashChainLedger` writes canonical JSONL records with append + `fsync` and validates the
entire chain on restart. It is a single-process qualification backend, not a replacement for
PostgreSQL in multi-worker deployments.

## PostgreSQL ledger

`PostgresEvidenceLedger` serializes chain-head updates through `evidence_ledger_state` using
`SELECT ... FOR UPDATE`. Each append calculates the next sequence and root while holding the
chain-head lock, inserts the event, and advances the durable root in the same database
transaction. The PostgreSQL integration suite includes cross-connection parallel append and
restart verification, but that suite requires `psycopg` and a live PostgreSQL service.

## External anchors

Anchors contain:

- anchored event sequence;
- ledger root at that sequence;
- previous anchor hash;
- signing key ID;
- Ed25519 signature;
- self-hash over the signed anchor document.

`FileAnchorStore` is an fsync-backed external-style sink used for local qualification. Production
systems should replace it with an independently administered WORM/Object-Lock/transparency
service. A local file is not immutable merely because Effect Fabric writes it append-only.

## Key rotation

Anchor verification uses `AnchorKeyring`, which retains old public keys while new anchors can be
signed by a new key ID. A key ID cannot be rebound to a different public key inside the keyring.

## Suffix deletion

An anchor proves a historical prefix. If a ledger that once contained N events is truncated below
an externally anchored sequence N, `verify_ledger_against_anchor()` fails even if the shortened
local hash chain is internally valid.

This is the threat that a local hash chain alone cannot detect.

## Remaining limitation: state/evidence atomic coupling

v0.1.4 makes evidence durable and externally anchorable. It does **not** yet claim that every
application-state transition and its evidence record are committed in one cross-module database
transaction. A crash in the narrow interval between a state transition and its evidence append
can therefore leave a detectable audit gap. Closing that gap requires a transactional evidence
outbox or store-integrated event emission and is an explicit next hardening gate.
