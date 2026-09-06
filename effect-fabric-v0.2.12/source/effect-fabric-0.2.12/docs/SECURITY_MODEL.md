# Security Model

## Adversary assumptions

Assume an agent can be malicious, prompt-injected, confused, or compromised. It may attempt to:

- change arguments after approval
- substitute a valid capability into a different transaction
- replay a consumed or revoked authorization
- call an unregistered mutating tool
- exploit a timeout to trigger duplicate execution
- access credentials directly
- forge a success claim
- trick a recovery action into overwriting third-party changes
- continue writing after its lease is superseded
- tamper with local evidence

Effect Fabric must not rely on model cooperation for enforcement.

## Required separation

High-risk deployments should separate:

- authority signer
- effect executor
- independent verifier
- reconciler/recovery worker
- credential broker
- ledger anchor destination

The verifier should use independent, preferably read-only credentials. An executor compromising its
own response must not be sufficient to mark the effect verified.

## Exact-action and exact-transaction binding

v0.1.5 capabilities bind:

- capability ID
- transaction ID
- subject
- action digest
- executor
- issue/expiry time
- one-use count
- policy version
- approval digest
- signer key ID

The action digest independently binds canonical operation/resource/arguments and the Effect Contract
digest. Execution additionally requires the capability ID to equal the transaction's current active
capability reference. Signature validity alone is insufficient.

## Reauthorization and replay

Only one capability may be active for a transaction. Issuing a replacement revokes the prior active
grant. The state store must atomically validate and consume the active capability before external
I/O. Legacy v0.1.0 capabilities are revoked during migration because their signatures did not bind
transaction identity.

## Ambiguous outcomes

A network timeout is not proof of failure. Once a mutating call may have reached the provider, the
state becomes UNKNOWN unless a definitive outcome exists. UNKNOWN requires reconciliation and is
never blindly retried.

## Fencing

Workers receive monotonically increasing fencing epochs. State updates from stale epochs are
rejected so a zombie worker cannot overwrite a newer recovery decision.

## Optional API boundary

The transaction API is disabled by default. Enabling it requires explicit bearer authentication and
returns a redacted summary. This is a safe reference default, not production tenant isolation.
Production deployments still require workload/service identity, tenant/resource authorization,
rate limiting, audit, and preferably an external API gateway.

## Ledger limits

The local hash chain detects internal mutation/reordering. v0.1.4 added fsync-backed restart
qualification, a PostgreSQL chain-head implementation, chained signed anchors, key rotation, and
anchored-prefix checks that expose local suffix deletion when an external anchor remains available.
v0.1.5 adds a transactional evidence outbox: security-critical state changes and their evidence
intents commit together, then a leased dispatcher materializes the intent into the hash chain using
the outbox UUID as an idempotency key. This closes the state/evidence-intent crash gap and the
append-before-ack duplicate-event gap. `FileAnchorStore` remains only a qualification sink;
production must persist anchors in an independently controlled WORM/Object-Lock/transparency
destination.

## Counterfactual sandbox boundary

Counterfactual sandboxes are not production executors. They receive test identities, local fixtures,
replayed responses, or disposable tenants. They do not receive production credentials or Effect
Fabric capabilities.

## Out of scope for v0.1.5

- hostile-host protection
- HSM-backed authority keys
- remote attestation
- formal verification
- exactly-once external effects
- arbitrary distributed atomic commit
- production tenant authorization implementation
