# Effect Fabric v0.2.12 — Trust Boundary Hardening

Effect Fabric is a transactional safety kernel for consequential autonomous actions. v0.2.12
preserves the v0.2.10 Effect Gateway and adds two missing trust primitives: **cryptographic workload
identity** for execution attribution and **environment/release-bound external ledger checkpoints**.

The release still does not claim production workload attestation or external WORM storage. It adds
locally qualified mechanisms and keeps those production gates explicitly `NOT_RUN` until a real KMS /
workload-attestation system and independently administered immutable anchor service are exercised.

## What changed in v0.2.12

- Added `WorkloadAuthority`, `WorkloadSigner`, `WorkloadCredential`, `WorkloadAssertion`, and
  `WorkloadVerifier` using Ed25519 signatures.
- Workload credentials bind worker ID, agent subject, environment, release, expiry, and a per-worker
  public key.
- `EffectEngine` can require workload identity before capability consumption.
- `effect.started` evidence can carry the signed worker admission assertion.
- Execution attempts persist workload credential ID and credential digest.
- Outcome evidence can carry a worker-signed assertion bound to transaction, action digest, executor,
  attempt ID, and fencing epoch.
- Added migration `007_workload_identity.sql`.
- Extended ledger anchors to bind `environment_id` and `release_id`.
- Added `DirectoryAnchorStore` with one-file-per-anchor exclusive creation and directory fsync.
- Added `HttpAnchorStore` for integration with an independently administered external anchor service.
- Added local workload-identity and external-anchor qualification gates.
- Preserved production gates `production_workload_identity` and `external_worm_anchor` as `NOT_RUN`.

## Architecture

```text
Agent / Personal Assistant / NARE
              |
              v
        Effect Gateway
       /      |       \
 Registry   Policy   EffectEngine
                       |
                signed worker identity
                       |
                 PostgreSQL/store
                       |
                evidence outbox
                       |
                 hash-chain ledger
                       |
                signed checkpoint
                       |
             independent anchor sink
                       |
                    MCP / API
```

The gateway remains the only consequential-mutation entry point. A production deployment should also
configure `EffectEngine(require_workload_identity=True, ...)` and ensure agents cannot reach the
underlying mutating transport directly.

## Workload identity

A workload authority signs a short-lived credential for a specific worker key:

```python
from effect_fabric.identity import WorkloadAuthority, WorkloadSigner, WorkloadVerifier

authority = WorkloadAuthority(key_id="runtime-ca")
signer = WorkloadSigner.enroll(
    authority,
    worker_id="worker-7",
    subject="personal-assistant",
    environment_id="home-prod",
    release_id="0.2.12",
)
verifier = WorkloadVerifier.from_authority(authority)
```

Configure the engine:

```python
engine = EffectEngine(
    workload_verifier=verifier,
    require_workload_identity=True,
    environment_id="home-prod",
    release_id="0.2.12",
)
```

Then execute using the worker signer. The credential is verified before capability consumption and
signed assertions are emitted into evidence.

## External anchors

`AnchorSigner` now binds checkpoints to environment and release. For local qualification,
`DirectoryAnchorStore` provides append-only-by-construction files. `HttpAnchorStore` provides the
transport contract for a remote service:

```text
GET  /anchors
POST /anchors
```

A remote HTTP service is **not** considered WORM merely because it accepts these calls. Object Lock,
retention policy, administrative separation, and deletion resistance must be qualified separately.

## Existing safety model retained

v0.2.12 retains the canonical transition algebra, exact capabilities, STARTED-before-provider-I/O,
UNKNOWN/reconciliation semantics, attempt fencing, outbox claim tokens, PostgreSQL constraints,
source-bound qualification evidence, native DAO compatibility infrastructure, and the v0.2.10 Effect
Gateway with fail-closed tool/schema routing.

## Qualification posture

The release is **REFERENCE_QUALIFIED**, not production-qualified. Local workload identity and local
independent anchoring can PASS. Live PostgreSQL crash/fencing, external DAO donor qualification,
Ruff/mypy where unavailable, live GitHub qualification, external WORM/Object-Lock anchoring,
production KMS/workload attestation, and production native-kernel promotion remain separate gates.
