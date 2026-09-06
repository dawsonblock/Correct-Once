# Provider Semantics

The provider boundary is where a correct local state machine meets systems that do not participate
in Effect Fabric's database transaction. v0.1.4 therefore treats provider outcomes by evidence, not
by exception type alone.

## Execution failure classes

`ProviderExecutionError` records:

- `kind`: operational classification;
- `may_have_happened`: whether the external mutation may already exist;
- `safe_to_retry`: whether the provider contract proves retry is safe;
- sanitized metadata such as status class or retry-after.

Important rule: `safe_to_retry=true` is meaningful only when `may_have_happened=false`. A safe retry
still requires a fresh authorization and must also be allowed by the transaction's idempotency
contract.

If `may_have_happened=true`, execution enters `UNKNOWN` and only reconciliation can move it forward.
An unclassified exception is also treated as potentially post-effect.

## Reconciliation

Reconciliation asks provider-specific authoritative state whether the intended effect exists.

- `HAPPENED` -> `RECONCILED` -> independent verification;
- `NOT_HAPPENED` -> `PREPARED` only if the idempotency contract allows retry;
- `UNKNOWN` -> remain `UNKNOWN`;
- reconciliation exception -> remain `UNKNOWN` and emit `effect.reconciliation_inconclusive`.

Reconciliation never fabricates a provider receipt.

## Verification observation failures

An executor's response does not prove post-state. The separate verifier can raise a typed
`VerifierObservationError` containing `kind` and `retryable`.

Transient states such as rate limiting, provider outage, or explicitly signaled eventual
consistency may be retried up to `EffectContract.max_verification_attempts`. Exhaustion yields
`INCONCLUSIVE`. A stable authoritative observation that violates the contract yields `MISMATCH`.

This distinction prevents eventual consistency from being confused with a real incorrect effect.

## Deterministic qualification provider

`effect_fabric.qualification` ships a loopback-only HTTP provider with deterministic scenarios:

- success;
- mutate then drop the connection;
- drop before mutation;
- definitive rejection;
- pre-effect service unavailability;
- rate limiting;
- protocol violation after mutation;
- delayed/eventually consistent observation;
- verifier outage;
- third-party state drift.

The harness is an executable specification of provider semantics. It is not evidence that a real
provider implements the same behavior.
