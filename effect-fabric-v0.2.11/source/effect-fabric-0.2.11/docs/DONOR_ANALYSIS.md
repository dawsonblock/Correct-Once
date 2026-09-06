# Donor Analysis and Integration Decisions

This build was produced after extracting the supplied donor archives. The goal is not to claim novelty for primitives that already exist; the goal is to compose the strongest semantics behind a smaller, testable protocol.

## OpenOnce

Adopt conceptually:
- explicit ambiguous/unknown external outcomes
- provider reconciliation rather than blind retry
- idempotency as a first-class contract
- provider-specific probing/reconciliation

Do not copy blindly:
- the extracted implementations showed semantic differences between storage backends around mutable fields. Effect Fabric therefore defines immutable transaction identity as a store conformance requirement.

## PALO Framework

Adopt conceptually:
- Effect Contracts
- action claims/capabilities
- execution receipts
- outcome attestations
- separate authoritative verification

Keep outside the core:
- broader governance/UI/documentation surface. RAF or another authority plane can own organization-wide governance.

## Revoco

Adopt conceptually:
- recovery is not proved by an `undo` API success response
- recovery must be checked against observed world state
- reversibility should be qualified/drilled, not blindly trusted as metadata

Future work:
- persist recovery qualification IDs/expiry and automatically downgrade stale reversibility classifications.

## Agent-Saga

Adopt conceptually:
- durable compensation intent
- explicit compensation order and recovery worker concepts

Change:
- compensation becomes a normal EffectTransaction rather than a privileged hidden path.

## mcp-compensator

Adopt conceptually:
- tool registry / compensation metadata UX
- MCP proxy placement

Reject consequential ordering:
- the extracted design can invoke a mutating downstream tool before a durable journal record of the performed effect. A crash in that window can leave external state changed without durable local intent/effect evidence. Effect Fabric persists STARTED before network I/O.

## EffectWitness

Adopt:
- ambiguous crash-window testing
- independent observation after restart
- fail closed on unresolved outcomes

## Mitos

Wrap only:
- snapshot/fork infrastructure for parallel candidate execution

Never vendor into the effect core. Snapshotting a VM does not snapshot GitHub, Stripe, Gmail, Salesforce, or the physical world. A winning sandbox candidate must still generate a fresh production ActionIntent.

## Sentinel / Agent-ACID / AEGIS ForkGuard

Use as design/research references for shadow or counterfactual execution. Do not place them on the correctness-critical path without separate qualification.

The extracted Sentinel snapshot had an invalid `package.json`, reinforcing the distinction between architectural inspiration and a qualified dependency.

## Toffoli / Irredux

Adopt:
- distinction between reversible, compensable, irreversible, and unknown effects
- use irreversibility as a routing/approval signal

Change:
- classification should eventually be tied to executable recovery qualification evidence rather than model inference alone.

## AgentReplay / Counterfact

Use for diagnostics/evaluation only. They are useful for trajectory replay and causal/counterfactual analysis, but are not part of the trusted external-effect commit path.
