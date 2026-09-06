# Architecture

## Responsibility split

Effect Fabric owns the semantics of consequential external effects. It does not own planning, model inference, browser automation, general workflow orchestration, or sandbox implementation.

A higher control plane such as RAF should answer **may this subject attempt this action?** Effect Fabric should answer **what exact action was authorized, did it actually happen, is the result verified, and what happens if the answer is uncertain or wrong?**

## Three orthogonal lifecycle axes

### Execution

`PLANNED -> PREPARED -> AUTHORIZED -> STARTED -> RECEIPT_RECORDED`

Exceptional states include `UNKNOWN` and `EXECUTION_FAILED`.

`UNKNOWN` means the provider may have performed the effect but the caller cannot prove either outcome. Retrying from `UNKNOWN` is forbidden unless reconciliation first establishes `NOT_HAPPENED` and the Idempotency Contract explicitly permits re-arming.

### Verification

`NOT_RUN -> VERIFYING -> VERIFIED | MISMATCH | INCONCLUSIVE`

A provider receipt does not set `VERIFIED`.

### Recovery

`NONE | AVAILABLE -> COMPENSATION_REQUIRED -> COMPENSATING -> COMPENSATED | RECOVERY_FAILED`

Irreversible actions use `IRREVERSIBLE`.

## Trusted protocol objects

### ActionIntent

Binds subject, operation, resource, canonical arguments, deadline, trace context, and optional parent intent.

### EffectContract

Describes required preconditions, expected post-state, forbidden post-state, and verifier identity. v0.1 uses a deliberately constrained predicate language rather than executable user code.

### IdempotencyContract

Describes the logical effect identity and whether retries are legal after specific reconciliation outcomes.

### ReversibilitySpec

Classifies an action as read-only, natively reversible, compensable, irreversible, or unknown. Reversible/compensable actions must name a recovery operation. Future versions should bind this to fresh recovery-qualification evidence.

### ExecutionCapability

Short-lived, exact-action-bound, Ed25519-signed, single-use authorization. Consumption is a state-store operation; signature verification alone does not prevent replay.

### OutcomeAttestation

Independent verifier result: verified, mismatch, or inconclusive.

## Durable ordering

Production ordering must be:

1. validate capability
2. atomically consume capability
3. increment fencing epoch
4. persist STARTED execution attempt
5. commit DB transaction
6. perform external network I/O
7. persist provider receipt, or enter UNKNOWN if the result cannot be established
8. independently verify provider state

The external call must never precede durable STARTED state.

## Compensation

Recovery is not a private method on an executor. It is generated as a new ActionIntent with its own authorization, idempotency, execution attempt, reconciliation, verification, and evidence.

That is necessary because recovery itself can conflict, fail, become ambiguous, or cause additional external effects.

## Counterfactual execution

Mitos/Firecracker belongs outside the effect core:

```text
snapshot S0
  |-- candidate A
  |-- candidate B
  `-- candidate C
        |
     evaluator
        |
   winning proposal
        |
 re-read production state
        |
 new ActionIntent + fresh authorization
        |
   Effect Fabric commit
```

Counterfactual environments must not contain production credentials or reusable production capabilities.


## v0.1.5 transactional evidence path

```text
security-critical transition
        |
        +-- domain state update
        +-- evidence intent
        |
        +-- atomic store commit
                 |
                 v
          evidence outbox
                 |
          leased dispatcher
                 |
                 v
          hash-chain ledger
                 |
          signed anchor path
```

The outbox separates the atomic local guarantee from at-least-once materialization. The ledger
deduplicates `source_outbox_id`, so replay after dispatcher failure does not create a second event.
