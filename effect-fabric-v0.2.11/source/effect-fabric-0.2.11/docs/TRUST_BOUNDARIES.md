# Trust Boundaries — v0.2.11

## 1. Workload identity

The execution worker is no longer required to be identified only by a caller-supplied string. A
`WorkloadCredential` is authority-signed and binds:

- worker ID;
- agent subject;
- environment ID;
- release ID;
- per-worker public key;
- issuance/expiry;
- authority key ID.

The worker uses its private key to sign assertions. The engine verifies the authority credential and
worker signature before execution when workload identity is required.

## 2. Attempt binding

The store still owns the authoritative attempt ID and fencing epoch. The start evidence contains the
signed worker admission statement; the store atomically enriches that event with the generated
attempt/fence. Before provider I/O, the worker signs a concrete attempt-bound assertion. Final
outcome assertions bind the same attempt and fencing epoch.

## 3. Anchor independence

The evidence ledger remains hash chained. A signed `LedgerAnchor` checkpoints a ledger prefix and
now includes environment/release identity. Anchor stores are intentionally separate from the ledger
backend.

`DirectoryAnchorStore` is local append-only-by-construction, not WORM. `HttpAnchorStore` is only a
transport adapter. A production WORM claim requires deployment-specific evidence.

## 4. Required deployment topology

```text
agent -> Effect Gateway -> EffectEngine -> provider
                         |       |
                         |       +-> workload verifier
                         +-> transactional store -> evidence ledger -> external anchor
```

Do not expose a second direct mutation path from the agent to the provider.

## 5. Production gates still required

- real PostgreSQL crash/fencing qualification;
- KMS/HSM or equivalent workload credential authority;
- workload/service attestation where required;
- independently administered WORM/Object-Lock anchor service;
- live provider fault qualification;
- mandatory Ruff/mypy gates;
- controlled production kernel promotion.
