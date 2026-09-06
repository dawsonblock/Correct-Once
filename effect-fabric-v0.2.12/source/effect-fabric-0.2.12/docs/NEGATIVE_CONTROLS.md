# Reducer Negative Controls

A conformance suite that passes one correct implementation can still be vacuous. v0.2.5 therefore
ships eight deliberately broken reducer adapters modeled on the published durable-agent-outbox
negative-control bug families.

| Mutant | Modeled defect | Required scenario failures |
|---|---|---|
| `eagerResolve` | Presume an `IN_DOUBT` effect landed without authority | unknown wait/revocation scenarios |
| `ackedRevoked` | Rewrite completed work as cancelled-before-execution | completed-work withdrawal |
| `strandsInDoubt` | Never apply available settlements | reconciliation progress/drain |
| `deliveryKeyed` | Derive idempotency identity from transport delivery | duplicate delivery + retry stability |
| `selfRevoke` | Suppress all work and pass safety vacuously | execution liveness |
| `trustsAnyReceipt` | Believe forged/unauthenticated settlements | forged receipt refusal |
| `noncesAreConsumed` | Consume settlement evidence on first sight | durable receipt re-read |
| `nop` | Accept work but do nothing | **all 17 scenarios** |

The qualification gate requires:

- every mutant fails the suite;
- every mutant fails every scenario in its declared minimum floor;
- the no-op mutant fails all 17 scenarios;
- mutants fail ordinary assertions rather than merely crashing.

These are Python ports of the donor bug families, not copied upstream TypeScript mutants. The actual
upstream conformance/mutant adapter remains a separate promotion gate.
