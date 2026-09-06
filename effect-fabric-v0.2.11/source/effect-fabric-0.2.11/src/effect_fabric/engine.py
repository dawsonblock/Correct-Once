from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from typing import Any

from .capabilities import CapabilityAuthority
from .errors import (
    AuthorizationError,
    ProviderExecutionError,
    RecoveryUnavailable,
    VerifierObservationError,
)
from .faults import FaultInjector
from .interfaces import EffectExecutor, EffectVerifier
from .identity import WorkloadAssertion, WorkloadSigner, WorkloadVerifier
from .ledger import EvidenceEvent, EvidenceLedger, HashChainLedger
from .models import (
    ActionIntent,
    AttemptState,
    EffectContract,
    EffectTransaction,
    ExecutionCapability,
    ExecutionState,
    IdempotencyContract,
    Observation,
    OutcomeAttestation,
    RecoveryPlan,
    RecoveryState,
    ReconciliationStatus,
    ReversibilityClass,
    ReversibilitySpec,
    VerificationState,
)
from .outbox import EvidenceIntent, EvidenceOutboxDispatcher
from .predicates import attest, evaluate
from .store import InMemoryStore, Store
from .transition_kernel import TransitionCommand, apply_transaction_transition


class EffectEngine:
    def __init__(
        self,
        *,
        store: Store | None = None,
        authority: CapabilityAuthority | None = None,
        ledger: EvidenceLedger | None = None,
        faults: FaultInjector | None = None,
        evidence_worker_id: str = "engine-evidence",
        workload_verifier: WorkloadVerifier | None = None,
        require_workload_identity: bool = False,
        environment_id: str = "development",
        release_id: str = "0.2.11",
    ):
        self.store = store or InMemoryStore()
        self.authority = authority or CapabilityAuthority()
        self.ledger = ledger or HashChainLedger()
        self.faults = faults
        self.workload_verifier = workload_verifier
        self.require_workload_identity = require_workload_identity
        self.environment_id = environment_id
        self.release_id = release_id
        self.executors: dict[str, EffectExecutor] = {}
        self.verifiers: dict[str, EffectVerifier] = {}
        self.recovery_plans: dict[str, RecoveryPlan] = {}
        self.evidence_dispatcher = EvidenceOutboxDispatcher(
            self.store,
            self.ledger,
            worker_id=evidence_worker_id,
        )

    def _hit(self, point: str) -> None:
        if self.faults is not None:
            self.faults.hit(point)

    async def flush_evidence(self) -> list[EvidenceEvent]:
        # Callers may swap the ledger after engine construction (e.g. qualification backends).
        self.evidence_dispatcher.ledger = self.ledger
        return await self.evidence_dispatcher.drain()

    async def _record(
        self,
        transaction_id: str,
        event_type: str,
        payload: dict[str, Any] | None = None,
    ) -> EvidenceEvent:
        await self.store.enqueue_evidence(
            transaction_id,
            EvidenceIntent(event_type=event_type, payload=payload or {}),
        )
        events = await self.flush_evidence()
        if not events:  # pragma: no cover - defensive; item was just enqueued.
            raise RuntimeError("evidence outbox failed to dispatch enqueued event")
        return events[-1]

    async def _flush_after_atomic_transition(self, fault_point: str) -> None:
        # A process death here leaves a durable outbox item coupled to the committed state.
        self._hit(fault_point)
        await self.flush_evidence()

    def register_executor(self, executor: EffectExecutor) -> None:
        self.executors[executor.name] = executor

    def register_verifier(self, verifier: EffectVerifier) -> None:
        self.verifiers[verifier.name] = verifier

    def register_recovery(self, operation: str, plan: RecoveryPlan) -> None:
        self.recovery_plans[operation] = plan

    async def propose(
        self,
        *,
        intent: ActionIntent,
        contract: EffectContract,
        idempotency: IdempotencyContract,
        reversibility: ReversibilitySpec,
    ) -> EffectTransaction:
        tx = EffectTransaction(
            intent=intent,
            contract=contract,
            idempotency=idempotency,
            reversibility=reversibility,
            action_digest=intent.action_digest(contract),
            recovery_state=(
                RecoveryState.IRREVERSIBLE
                if reversibility.classification == ReversibilityClass.IRREVERSIBLE
                else RecoveryState.AVAILABLE
                if reversibility.classification
                in {
                    ReversibilityClass.NATIVELY_REVERSIBLE,
                    ReversibilityClass.COMPENSABLE,
                }
                else RecoveryState.NONE
            ),
        )
        saved = await self.store.create_transaction(
            tx,
            evidence=EvidenceIntent(
                event_type="effect.proposed",
                payload={"action_digest": tx.action_digest},
            ),
        )
        await self._flush_after_atomic_transition("after_proposed_transition_committed")
        return saved

    async def prepare(self, transaction_id: str, executor_name: str) -> EffectTransaction:
        tx = await self.store.get_transaction(transaction_id)
        executor = self.executors[executor_name]
        prepared = await executor.prepare(tx.intent, tx.contract)
        for predicate in tx.contract.preconditions:
            if not evaluate(predicate, prepared.observed_pre_state):
                raise AuthorizationError(
                    f"precondition failed: {predicate.path} {predicate.operator}"
                )
        tx.prepared = prepared
        apply_transaction_transition(tx, TransitionCommand.PREPARE)
        await self.store.save_transaction(
            tx,
            expected_fence=tx.fencing_epoch,
            evidence=EvidenceIntent(
                event_type="effect.prepared",
                payload={"external_version": prepared.external_version},
            ),
        )
        await self._flush_after_atomic_transition("after_prepared_transition_committed")
        return tx

    async def authorize(
        self,
        transaction_id: str,
        executor_name: str,
        *,
        ttl_seconds: int = 60,
        policy_version: str = "dev/v1",
        approval_digest: str | None = None,
    ) -> ExecutionCapability:
        tx = await self.store.get_transaction(transaction_id)
        if tx.execution_state not in {ExecutionState.PREPARED, ExecutionState.AUTHORIZED}:
            raise AuthorizationError("transaction must be prepared before authorization")
        if executor_name not in self.executors:
            raise AuthorizationError("unknown executor")

        cap = self.authority.issue(
            transaction_id=tx.transaction_id,
            subject=tx.intent.subject,
            action_digest=tx.action_digest,
            executor=executor_name,
            policy_version=policy_version,
            ttl_seconds=ttl_seconds,
            approval_digest=approval_digest,
        )
        self.authority.verify(
            cap,
            expected_digest=tx.action_digest,
            expected_transaction_id=tx.transaction_id,
            expected_subject=tx.intent.subject,
            expected_executor=executor_name,
        )
        await self.store.authorize_transaction(
            cap,
            expected_fence=tx.fencing_epoch,
            evidence=EvidenceIntent(
                event_type="effect.authorized",
                payload={
                    "transaction_id": cap.transaction_id,
                    "policy_version": cap.policy_version,
                },
            ),
        )
        self._hit("after_authorization_persisted")
        await self._flush_after_atomic_transition("after_authorized_transition_committed")
        return cap

    def _verify_workload_assertion(
        self,
        assertion: WorkloadAssertion | None,
        *,
        tx: EffectTransaction,
        executor: str,
        worker_id: str,
        kind: str,
        attempt_id: str | None = None,
        fencing_epoch: int | None = None,
    ) -> None:
        if assertion is None:
            if self.require_workload_identity:
                raise AuthorizationError("workload identity is required for execution")
            return
        if self.workload_verifier is None:
            raise AuthorizationError("workload assertion supplied without a configured verifier")
        try:
            self.workload_verifier.verify_assertion(
                assertion,
                expected_kind=kind,
                expected_transaction_id=tx.transaction_id,
                expected_action_digest=tx.action_digest,
                expected_executor=executor,
                expected_worker_id=worker_id,
                expected_subject=tx.intent.subject,
                expected_environment_id=self.environment_id,
                expected_release_id=self.release_id,
                expected_attempt_id=attempt_id,
                expected_fencing_epoch=fencing_epoch,
            )
        except Exception as exc:
            raise AuthorizationError(f"invalid workload assertion: {type(exc).__name__}") from exc

    def _outcome_assertion(
        self,
        signer: WorkloadSigner | None,
        *,
        tx: EffectTransaction,
        executor: str,
        worker_id: str,
        attempt_id: str,
        fencing_epoch: int,
        outcome: str,
        metadata: dict[str, Any] | None = None,
    ) -> WorkloadAssertion | None:
        if signer is None:
            return None
        assertion = signer.sign(
            kind="effect.execute.outcome",
            transaction_id=tx.transaction_id,
            action_digest=tx.action_digest,
            executor=executor,
            attempt_id=attempt_id,
            fencing_epoch=fencing_epoch,
            outcome=outcome,
            metadata=metadata,
        )
        self._verify_workload_assertion(
            assertion,
            tx=tx,
            executor=executor,
            worker_id=worker_id,
            kind="effect.execute.outcome",
            attempt_id=attempt_id,
            fencing_epoch=fencing_epoch,
        )
        return assertion

    async def execute(
        self,
        transaction_id: str,
        capability: ExecutionCapability,
        *,
        worker_id: str = "engine",
        lease_seconds: int = 30,
        workload_signer: WorkloadSigner | None = None,
    ) -> EffectTransaction:
        tx = await self.store.get_transaction(transaction_id)
        self.authority.verify(
            capability,
            expected_digest=tx.action_digest,
            expected_transaction_id=tx.transaction_id,
            expected_subject=tx.intent.subject,
            expected_executor=capability.executor,
        )
        if capability.executor not in self.executors:
            raise AuthorizationError("unknown executor")
        if tx.capability_id != capability.capability_id:
            raise AuthorizationError("capability is not the transaction's active authorization")
        if tx.prepared is None:
            raise AuthorizationError("transaction not prepared")

        start_assertion = (
            workload_signer.sign(
                kind="effect.execute.start",
                transaction_id=tx.transaction_id,
                action_digest=tx.action_digest,
                executor=capability.executor,
            )
            if workload_signer is not None
            else None
        )
        self._verify_workload_assertion(
            start_assertion,
            tx=tx,
            executor=capability.executor,
            worker_id=worker_id,
            kind="effect.execute.start",
        )
        workload_credential_id = (
            start_assertion.credential.credential_id if start_assertion is not None else None
        )
        workload_identity_digest = (
            start_assertion.credential.digest if start_assertion is not None else None
        )

        attempt = await self.store.consume_capability_and_start(
            capability_id=capability.capability_id,
            transaction_id=transaction_id,
            executor=capability.executor,
            worker_id=worker_id,
            lease_seconds=lease_seconds,
            workload_credential_id=workload_credential_id,
            workload_identity_digest=workload_identity_digest,
            evidence=EvidenceIntent(
                event_type="effect.started",
                payload={
                    "capability_id": capability.capability_id,
                    "workload_assertion": (
                        start_assertion.model_dump(mode="json")
                        if start_assertion is not None
                        else None
                    ),
                },
            ),
        )
        await self._flush_after_atomic_transition("after_started_transition_committed")
        self._hit("after_started_persisted")
        if workload_signer is not None:
            bound_assertion = workload_signer.sign(
                kind="effect.attempt.bound",
                transaction_id=tx.transaction_id,
                action_digest=tx.action_digest,
                executor=capability.executor,
                attempt_id=attempt.attempt_id,
                fencing_epoch=attempt.fencing_epoch,
            )
            self._verify_workload_assertion(
                bound_assertion,
                tx=tx,
                executor=capability.executor,
                worker_id=worker_id,
                kind="effect.attempt.bound",
                attempt_id=attempt.attempt_id,
                fencing_epoch=attempt.fencing_epoch,
            )
            await self._record(
                tx.transaction_id,
                "effect.attempt_identity_bound",
                {"workload_assertion": bound_assertion.model_dump(mode="json")},
            )
        executor = self.executors[capability.executor]
        try:
            receipt = await executor.execute(tx.intent, tx.prepared, attempt)
            self._hit("after_provider_returned")
        except ProviderExecutionError as exc:
            current = await self.store.get_transaction(transaction_id)
            if exc.may_have_happened:
                apply_transaction_transition(current, TransitionCommand.MARK_UNKNOWN)
                event_type = "effect.unknown"
                attempt_state = AttemptState.UNKNOWN
            elif exc.safe_to_retry and current.idempotency.retry_after_not_happened:
                apply_transaction_transition(
                    current, TransitionCommand.PROVIDER_RETRYABLE_PRE_EFFECT_FAILURE
                )
                current.capability_id = None
                current.authorization_policy_version = None
                current.approval_digest = None
                event_type = "effect.execution_retryable"
                attempt_state = AttemptState.FAILED
            else:
                apply_transaction_transition(
                    current, TransitionCommand.PROVIDER_DEFINITIVE_FAILURE
                )
                event_type = "effect.execution_failed"
                attempt_state = AttemptState.FAILED
            await self.store.finalize_attempt_transition(
                current,
                attempt_id=attempt.attempt_id,
                expected_fence=attempt.fencing_epoch,
                worker_id=worker_id,
                attempt_state=attempt_state,
                evidence=EvidenceIntent(
                    event_type=event_type,
                    payload={
                        "attempt_id": attempt.attempt_id,
                        "provider_error_kind": exc.kind.value,
                        "safe_to_retry": exc.safe_to_retry,
                        "may_have_happened": exc.may_have_happened,
                        "metadata": exc.metadata,
                        "workload_assertion": (
                            assertion.model_dump(mode="json")
                            if (assertion := self._outcome_assertion(
                                workload_signer,
                                tx=current,
                                executor=capability.executor,
                                worker_id=worker_id,
                                attempt_id=attempt.attempt_id,
                                fencing_epoch=attempt.fencing_epoch,
                                outcome=event_type,
                                metadata={"provider_error_kind": exc.kind.value},
                            )) is not None
                            else None
                        ),
                    },
                ),
            )
            await self._flush_after_atomic_transition("after_failure_transition_committed")
            self._hit("after_failure_persisted")
            if exc.may_have_happened:
                return current
            raise
        except Exception as exc:
            current = await self.store.get_transaction(transaction_id)
            apply_transaction_transition(current, TransitionCommand.MARK_UNKNOWN)
            await self.store.finalize_attempt_transition(
                current,
                attempt_id=attempt.attempt_id,
                expected_fence=attempt.fencing_epoch,
                worker_id=worker_id,
                attempt_state=AttemptState.UNKNOWN,
                evidence=EvidenceIntent(
                    event_type="effect.unknown",
                    payload={
                        "error": type(exc).__name__,
                        "classification": "unclassified_may_have_happened",
                        "safe_to_retry": False,
                        "workload_assertion": (
                            assertion.model_dump(mode="json")
                            if (assertion := self._outcome_assertion(
                                workload_signer,
                                tx=current,
                                executor=capability.executor,
                                worker_id=worker_id,
                                attempt_id=attempt.attempt_id,
                                fencing_epoch=attempt.fencing_epoch,
                                outcome="effect.unknown",
                                metadata={"error": type(exc).__name__},
                            )) is not None
                            else None
                        ),
                    },
                ),
            )
            await self._flush_after_atomic_transition("after_unknown_transition_committed")
            return current

        current = await self.store.get_transaction(transaction_id)
        current.receipt = receipt
        apply_transaction_transition(current, TransitionCommand.RECORD_RECEIPT)
        await self.store.finalize_attempt_transition(
            current,
            attempt_id=attempt.attempt_id,
            expected_fence=attempt.fencing_epoch,
            worker_id=worker_id,
            attempt_state=AttemptState.SUCCEEDED,
            evidence=EvidenceIntent(
                event_type="effect.receipt_recorded",
                payload={
                    "external_id": receipt.external_id,
                    "status_code": receipt.status_code,
                    "workload_assertion": (
                        assertion.model_dump(mode="json")
                        if (assertion := self._outcome_assertion(
                            workload_signer,
                            tx=current,
                            executor=capability.executor,
                            worker_id=worker_id,
                            attempt_id=attempt.attempt_id,
                            fencing_epoch=attempt.fencing_epoch,
                            outcome="effect.receipt_recorded",
                            metadata={"external_id": receipt.external_id},
                        )) is not None
                        else None
                    ),
                },
            ),
        )
        await self._flush_after_atomic_transition("after_receipt_transition_committed")
        self._hit("after_receipt_persisted")
        return current

    async def recover_orphaned_started(
        self,
        transaction_id: str,
        *,
        now: datetime | None = None,
    ) -> EffectTransaction:
        tx = await self.store.recover_orphaned_started(
            transaction_id,
            now=now,
            evidence=EvidenceIntent(event_type="effect.orphan_recovered"),
        )
        await self._flush_after_atomic_transition("after_orphan_transition_committed")
        return tx

    async def reconcile(self, transaction_id: str) -> ReconciliationStatus:
        tx = await self.store.get_transaction(transaction_id)
        if tx.execution_state != ExecutionState.UNKNOWN:
            raise ValueError("reconciliation only applies to UNKNOWN effects")
        if not tx.latest_attempt_id or tx.prepared is None:
            raise ValueError("missing execution attempt/prepared state")
        attempt = await self.store.get_attempt(tx.latest_attempt_id)
        try:
            status = await self.executors[attempt.executor].reconcile(
                tx.intent,
                tx.prepared,
                attempt,
            )
        except Exception as exc:
            await self._record(
                tx.transaction_id,
                "effect.reconciliation_inconclusive",
                {"error": type(exc).__name__},
            )
            return ReconciliationStatus.UNKNOWN

        current_fence = tx.fencing_epoch
        if status == ReconciliationStatus.HAPPENED:
            apply_transaction_transition(tx, TransitionCommand.RECONCILE_HAPPENED)
            await self.store.finalize_reconciliation_transition(
                tx,
                attempt_id=attempt.attempt_id,
                expected_fence=current_fence,
                evidence=EvidenceIntent(
                    event_type="effect.reconciled",
                    payload={"status": status.value},
                ),
            )
            await self._flush_after_atomic_transition("after_reconciled_transition_committed")
        elif status == ReconciliationStatus.NOT_HAPPENED:
            if tx.idempotency.retry_after_not_happened:
                apply_transaction_transition(
                    tx, TransitionCommand.RECONCILE_NOT_HAPPENED_RETRY
                )
                tx.capability_id = None
                tx.authorization_policy_version = None
                tx.approval_digest = None
                await self.store.finalize_reconciliation_transition(
                    tx,
                    attempt_id=attempt.attempt_id,
                    expected_fence=current_fence,
                    evidence=EvidenceIntent(
                        event_type="effect.reconciled",
                        payload={
                            "status": status.value,
                            "retry_requires_fresh_authorization": True,
                        },
                    ),
                )
                await self._flush_after_atomic_transition(
                    "after_not_happened_transition_committed"
                )
            else:
                await self._record(
                    tx.transaction_id,
                    "effect.reconciled",
                    {"status": status.value, "retry_allowed": False},
                )
        else:
            await self._record(tx.transaction_id, "effect.reconciled", {"status": status.value})
        return status

    async def verify(self, transaction_id: str) -> OutcomeAttestation:
        tx = await self.store.get_transaction(transaction_id)
        if tx.execution_state not in {
            ExecutionState.RECEIPT_RECORDED,
            ExecutionState.RECONCILED,
            ExecutionState.EXECUTION_FAILED,
        }:
            raise ValueError("effect is not ready for verification")
        verifier = self.verifiers[tx.contract.verifier]
        tx.verification_state = VerificationState.VERIFYING
        await self.store.save_transaction(
            tx,
            expected_fence=tx.fencing_epoch,
            evidence=EvidenceIntent(event_type="effect.verification_started"),
        )
        await self._flush_after_atomic_transition("after_verification_started_committed")

        max_attempts = tx.contract.max_verification_attempts
        result: OutcomeAttestation | None = None
        last_error: dict[str, Any] = {}
        for attempt_number in range(1, max_attempts + 1):
            try:
                observation: Observation = await verifier.observe(tx.intent, tx.contract)
                attestation = attest(verifier.name, tx.contract, observation.state)
                result = attestation.model_copy(
                    update={
                        "attempts": attempt_number,
                        "details": {"observation_metadata": observation.metadata},
                    }
                )
                break
            except VerifierObservationError as exc:
                last_error = {
                    "kind": exc.kind.value,
                    "retryable": exc.retryable,
                    "metadata": exc.metadata,
                }
                await self._record(
                    tx.transaction_id,
                    "effect.verification_observation_failed",
                    {"attempt": attempt_number, **last_error},
                )
                if exc.retryable and attempt_number < max_attempts:
                    continue
                result = OutcomeAttestation(
                    verifier=verifier.name,
                    contract_digest=tx.contract.digest,
                    state=VerificationState.INCONCLUSIVE,
                    mismatched=[f"verifier_observation:{exc.kind.value}"],
                    attempts=attempt_number,
                    details=last_error,
                )
                break
            except Exception as exc:
                last_error = {
                    "kind": "unclassified_verifier_failure",
                    "retryable": False,
                    "error_type": type(exc).__name__,
                }
                await self._record(
                    tx.transaction_id,
                    "effect.verification_observation_failed",
                    {"attempt": attempt_number, **last_error},
                )
                result = OutcomeAttestation(
                    verifier=verifier.name,
                    contract_digest=tx.contract.digest,
                    state=VerificationState.INCONCLUSIVE,
                    mismatched=[f"verifier_unavailable_or_failed:{type(exc).__name__}"],
                    attempts=attempt_number,
                    details=last_error,
                )
                break

        if result is None:  # pragma: no cover
            result = OutcomeAttestation(
                verifier=verifier.name,
                contract_digest=tx.contract.digest,
                state=VerificationState.INCONCLUSIVE,
                mismatched=["verification_exhausted_without_result"],
                attempts=max_attempts,
                details=last_error,
            )

        current = await self.store.get_transaction(transaction_id)
        current.attestation = result
        current.verification_state = result.state
        if (
            result.state == VerificationState.MISMATCH
            and current.recovery_state == RecoveryState.AVAILABLE
        ):
            current.recovery_state = RecoveryState.COMPENSATION_REQUIRED
        await self.store.save_transaction(
            current,
            expected_fence=current.fencing_epoch,
            evidence=EvidenceIntent(
                event_type="effect.verified",
                payload={
                    "state": result.state.value,
                    "mismatched": result.mismatched,
                    "attempts": result.attempts,
                },
            ),
        )
        await self._flush_after_atomic_transition("after_verified_transition_committed")
        return result

    async def build_recovery_intent(
        self,
        transaction_id: str,
    ) -> tuple[ActionIntent, EffectContract]:
        tx = await self.store.get_transaction(transaction_id)
        if tx.recovery_state not in {
            RecoveryState.COMPENSATION_REQUIRED,
            RecoveryState.AVAILABLE,
        }:
            raise RecoveryUnavailable(transaction_id)
        plan = self.recovery_plans.get(tx.intent.operation)
        if not plan:
            raise RecoveryUnavailable(f"no recovery plan for {tx.intent.operation}")
        intent = ActionIntent(
            subject=tx.intent.subject,
            operation=plan.recovery_operation,
            resource=tx.intent.resource,
            arguments=deepcopy(plan.arguments),
            trace_id=tx.intent.trace_id,
            parent_intent_id=tx.intent.intent_id,
        )
        return intent, plan.restoration_contract
