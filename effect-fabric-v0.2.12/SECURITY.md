# Security

Effect Fabric v0.2.12 is a correctness/reference build. It is not a production-certified
authorization boundary and it does not turn non-transactional external APIs into distributed ACID
resources.

## Preserved runtime invariants

- Capabilities are signed and bound to a specific transaction, subject, executor, action digest,
  policy version, approval digest, expiry, and use count.
- Reauthorization revokes the previous active grant.
- Capability consumption, fencing-epoch increment, attempt creation, `STARTED`, and evidence intent
  are coupled in the store transaction.
- Ambiguous provider outcomes become `UNKNOWN` and require reconciliation; they are never blindly
  interpreted as a safe retry.
- Provider receipts are evidence, not proof of authoritative external state.
- Verification is performed independently from the mutation path.
- Stale workers cannot finalize newer fenced execution state.
- Compensation is a new governed effect rather than a hidden undo callback.
- Evidence outbox redelivery is deduplicated by `source_outbox_id` at the ledger boundary.

## PostgreSQL attempt and evidence-claim fencing

v0.2.9 treats the transaction fencing epoch as necessary but not sufficient proof that a provider
result may be committed. Normal attempt completion also verifies that the attempt itself carries the
same epoch, remains `ACTIVE`, belongs to the transaction, and is owned by the worker performing the
finalization. This prevents an orphaned worker from completing an old attempt merely by observing a
newer transaction epoch.

Generic transaction persistence is not permitted to change `fencing_epoch`, and newly created
transactions must start at epoch zero. Epoch advancement is confined to dedicated START and orphan
recovery operations. This prevents a caller with access to generic save semantics from minting a
future fence.

Orphan settlement uses a different API: `finalize_reconciliation_transition`. It accepts only
`UNKNOWN` or `ORPHANED` historical attempts and is authorized by the transaction's current fence.
This distinction is intentional: provider completion belongs to the original attempt owner, while
reconciliation belongs to the current authority after uncertainty/takeover.

PostgreSQL additionally enforces at most one `ACTIVE` execution attempt per transaction with a
partial unique index. Evidence-outbox leases carry a random per-claim `claim_token`; ACK and release
operations must present both the logical worker ID and the exact claim token. Reclaiming an expired
row rotates the token, fencing stale dispatcher instances even when worker IDs are reused.

The live crash matrix is documented in `docs/POSTGRES_CRASH_MATRIX.md`. It is not considered PASS
unless a real PostgreSQL DSN is supplied and all live PostgreSQL tests execute with zero skips.

## Native DAO compatibility boundary

The newest locked durable-agent-outbox compatibility path redirects transition decisions to the
checked-in Effect Fabric native transition kernel. During upstream qualification the compiled donor
`reduce()` implementation is poisoned. A successful upstream native-path run therefore requires the
Effect Fabric reducer rather than silent donor fallback.

v0.2.9 retains the v0.2.7 hardening of that reducer so an `ATTEMPT_RESULT` must match both current epoch and active worker,
ACK must match the action epoch, and an already-recorded pending withdrawal rejects older/equal
withdrawal epochs.

The native compatibility kernel is MIT-derived and preserves donor protocol semantics. See
`THIRD_PARTY_NOTICES.md` and `LICENSES/durable-agent-outbox-MIT.txt`.

The compatibility kernel is **not** the production `EffectEngine` transaction/capability/evidence
model.

## Qualification-evidence integrity

A qualification report is trustworthy only if it is bound to the exact source that produced it.
v0.2.9 therefore maintains a deterministic `QUALIFICATION_INPUTS.sha256` over qualification/runtime
inputs and embeds its digest, the native-reducer digest, donor-lock digest, project metadata digest,
and release version in every stable gate report.

`generate_release_status.py`, `freeze_release.py`, and `verify_release_integrity.py` fail closed on
missing or stale provenance. Modifying source after qualification invalidates the release even if old
PASS JSON remains present.

If the external donor checkout is absent, upstream DAO reports are regenerated as current-source
`NOT_RUN` records. Historical PASS evidence is not inherited.

`MANIFEST.sha256` protects the frozen source tree and integrity verification rejects both changed
manifest entries and new unmanifested source files.

## Packaging boundary

The release builder verifies that the wheel contains:

- SQL migrations;
- the checked-in native DAO transition reducer;
- native DAO bridge runners;
- third-party notices and the donor MIT license.

This prevents the source archive from qualifying deployment-critical assets that the normal wheel
silently omits.

## GitHub provider precondition boundary

`GitHubIssueLabelExecutor.prepare()` records the issue ETag. If an ETag was available, `execute()`
performs a fresh read immediately before mutation and refuses the operation when the prepared version
changed.

This is a **fail-closed stale-state check**, not an atomic compare-and-swap with GitHub. A final
network TOCTOU window remains because the remote mutation is not transactionally coupled to the
revalidation read. Provider-specific reconciliation and independent verification remain necessary.

## Operational evidence health

Stores expose evidence-outbox health statistics. Operators should alert on at least:

- oldest pending evidence age;
- expired claims;
- redelivery count;
- repeated dispatch failures;
- evidence backlog growth;
- unresolved `UNKNOWN` transactions;
- `MISMATCH` or persistent `INCONCLUSIVE` verification;
- stale external anchor age.

v0.2.9 retains the outbox statistics primitive but does not ship a production metrics backend.

## Deployment restrictions

Do not expose the optional API directly to untrusted networks. Keep the transaction API disabled by
default. Production deployments still require workload identity, tenant/resource authorization,
credential brokering, key custody, and independently administered anchor storage.

Do not provide counterfactual/sandbox agents with production credentials or production network
reachability.

## Explicit unqualified boundaries

Unless a release artifact contains actual PASS evidence for the corresponding gate, treat these as
unqualified:

- PostgreSQL process-kill, failover, and concurrency behavior;
- live GitHub/provider chaos behavior;
- external WORM/Object-Lock anchoring;
- KMS/HSM signing-key custody;
- production service/workload identity;
- payments, destructive infrastructure actions, and physical effects;
- VM/container isolation such as Firecracker.

## Donor compatibility security rule

No donor decision or metadata is trusted merely because it was parsed. External authorization must be
cryptographically verified before mapping into `ExternalAuthorizationEvidence`; provider profiles
must be operator-qualified; compensation declarations are candidate recovery metadata; and imported
contracts are accepted only for operators Effect Fabric can represent faithfully. Unknown semantics
fail closed.


## Canonical transition boundary

v0.2.9 preserves legal production execution-state edges a centralized security boundary. `transition_kernel.py` is the only runtime module permitted to assign `execution_state`. Both in-memory and PostgreSQL persistence validate old→new edges independently before commit, and release qualification rejects reintroduction of direct runtime state writes. The canonical algebra does not replace fencing, capability, provider, or receipt-authentication checks; those remain mandatory outer guards.
## Effect Gateway boundary (v0.2.10)

The Effect Gateway is a privileged mutation boundary. Unknown tools are denied by default even if an MCP server advertises a read-only hint. Registered mutations require a current schema digest, a bound per-call effect definition, and an independent policy grant before Effect Fabric mints an execution capability. The MCP executor rechecks the schema immediately before external I/O. The secure default policy denies all mutations. Production deployments must ensure agents cannot access the underlying mutating transport through a second path that bypasses the gateway.


## Workload identity boundary (v0.2.12)

`EffectEngine` can require an authority-signed workload credential before it consumes an execution
capability. The credential binds the worker ID, agent subject, environment, release, expiry, and
worker public key. Worker assertions are signed by the per-worker key and verified against the
credential before they are accepted.

The `effect.started` evidence intent carries the signed admission assertion and the store atomically
adds the generated attempt ID, fencing epoch, lease owner, workload credential ID, and credential
digest. A second worker-signed assertion binds the concrete attempt ID/fence before provider I/O;
outcome evidence can carry another assertion bound to the same attempt and fence.

This prevents a caller from satisfying `require_workload_identity=True` with an arbitrary worker
label alone. It does **not** prove hardware-backed attestation, process isolation, secret custody, or
KMS/HSM-backed signing. Those properties remain part of the separate `production_workload_identity`
gate.

## External anchor boundary (v0.2.12)

Signed ledger checkpoints now bind the ledger root to `environment_id` and `release_id`, in addition
to sequence, previous anchor hash, timestamp, and signing key. `DirectoryAnchorStore` uses exclusive
file creation and directory fsync to make accidental overwrite harder and to provide a deterministic
independent-store qualification path. `HttpAnchorStore` provides a minimal transport adapter for a
separately administered service.

Neither a local directory nor an HTTP endpoint is automatically WORM. Production qualification must
prove deletion/overwrite resistance, retention configuration, administrative separation, key
custody, and recovery behavior of the actual remote system. Therefore `external_anchor_local` may
PASS while `external_worm_anchor` remains `NOT_RUN`.
