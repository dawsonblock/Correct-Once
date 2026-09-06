from __future__ import annotations

import asyncio
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol
from uuid import uuid4

from .errors import (
    CapabilityBindingMismatch,
    CapabilityConsumed,
    CapabilityExpired,
    CapabilityRevoked,
    DuplicateIdempotencyConflict,
    FencingEpochViolation,
    ImmutableFieldViolation,
    InvalidAttemptState,
    LeaseNotExpired,
    StaleAttemptOwner,
    StaleFence,
    StaleOutboxClaim,
)
from .models import (
    AttemptState,
    CapabilityStatus,
    EffectTransaction,
    ExecutionAttempt,
    ExecutionCapability,
    ExecutionState,
)
from .outbox import EvidenceIntent, EvidenceOutboxItem, EvidenceOutboxStats, OutboxStatus
from .transition_kernel import (
    TransitionCommand,
    apply_transaction_transition,
    validate_transaction_persistence,
)


class Store(Protocol):
    async def create_transaction(
        self,
        tx: EffectTransaction,
        *,
        evidence: EvidenceIntent | None = None,
    ) -> EffectTransaction: ...

    async def get_transaction(self, transaction_id: str) -> EffectTransaction: ...

    async def save_transaction(
        self,
        tx: EffectTransaction,
        *,
        expected_fence: int | None = None,
        evidence: EvidenceIntent | None = None,
    ) -> None: ...

    async def authorize_transaction(
        self,
        capability: ExecutionCapability,
        *,
        expected_fence: int | None = None,
        evidence: EvidenceIntent | None = None,
    ) -> EffectTransaction: ...

    async def consume_capability_and_start(
        self,
        *,
        capability_id: str,
        transaction_id: str,
        executor: str,
        worker_id: str = "engine",
        lease_seconds: int = 30,
        workload_credential_id: str | None = None,
        workload_identity_digest: str | None = None,
        evidence: EvidenceIntent | None = None,
    ) -> ExecutionAttempt: ...

    async def recover_orphaned_started(
        self,
        transaction_id: str,
        *,
        now: datetime | None = None,
        evidence: EvidenceIntent | None = None,
    ) -> EffectTransaction: ...

    async def finalize_attempt_transition(
        self,
        tx: EffectTransaction,
        *,
        attempt_id: str,
        expected_fence: int,
        worker_id: str,
        attempt_state: AttemptState,
        evidence: EvidenceIntent | None = None,
    ) -> None: ...

    async def finalize_reconciliation_transition(
        self,
        tx: EffectTransaction,
        *,
        attempt_id: str,
        expected_fence: int,
        evidence: EvidenceIntent | None = None,
    ) -> None: ...

    async def complete_attempt(
        self,
        attempt_id: str,
        *,
        expected_fence: int,
        worker_id: str,
        state: AttemptState,
    ) -> None: ...

    async def get_attempt(self, attempt_id: str) -> ExecutionAttempt: ...

    async def enqueue_evidence(
        self,
        transaction_id: str,
        evidence: EvidenceIntent,
    ) -> EvidenceOutboxItem: ...

    async def claim_evidence(
        self,
        *,
        worker_id: str,
        lease_seconds: int = 30,
    ) -> EvidenceOutboxItem | None: ...

    async def mark_evidence_delivered(
        self,
        outbox_id: str,
        *,
        worker_id: str,
        claim_token: str,
        event_id: str,
    ) -> None: ...

    async def release_evidence_claim(
        self,
        outbox_id: str,
        *,
        worker_id: str,
        claim_token: str,
        error: str,
    ) -> None: ...

    async def pending_evidence_count(self) -> int: ...

    async def evidence_outbox_stats(self) -> EvidenceOutboxStats: ...


_IMMUTABLE_TX_FIELDS = {
    "transaction_id",
    "intent",
    "contract",
    "idempotency",
    "reversibility",
    "action_digest",
    "created_at",
}


class InMemoryStore:
    """Reference store with atomic transition + evidence-intent semantics."""

    def __init__(self):
        self._lock = asyncio.Lock()
        self._tx: dict[str, EffectTransaction] = {}
        self._caps: dict[str, tuple[ExecutionCapability, CapabilityStatus]] = {}
        self._idempotency: dict[str, tuple[str, str]] = {}
        self._attempts: dict[str, ExecutionAttempt] = {}
        self._outbox: dict[str, EvidenceOutboxItem] = {}
        self._outbox_order: list[str] = []

    def _enqueue_locked(
        self,
        transaction_id: str,
        evidence: EvidenceIntent | None,
        *,
        extra_payload: dict[str, Any] | None = None,
    ) -> EvidenceOutboxItem | None:
        if evidence is None:
            return None
        payload = dict(evidence.payload)
        if extra_payload:
            payload.update(extra_payload)
        item = EvidenceOutboxItem(
            transaction_id=transaction_id,
            event_type=evidence.event_type,
            payload=payload,
        )
        self._outbox[item.outbox_id] = deepcopy(item)
        self._outbox_order.append(item.outbox_id)
        return deepcopy(item)

    async def create_transaction(
        self,
        tx: EffectTransaction,
        *,
        evidence: EvidenceIntent | None = None,
    ) -> EffectTransaction:
        if tx.fencing_epoch != 0:
            raise FencingEpochViolation("new transactions must start at fencing epoch 0")
        async with self._lock:
            existing = self._idempotency.get(tx.idempotency.key)
            if existing and existing[0] != tx.action_digest:
                raise DuplicateIdempotencyConflict(tx.idempotency.key)
            if existing:
                return deepcopy(self._tx[existing[1]])
            self._tx[tx.transaction_id] = deepcopy(tx)
            self._idempotency[tx.idempotency.key] = (tx.action_digest, tx.transaction_id)
            self._enqueue_locked(tx.transaction_id, evidence)
            return deepcopy(tx)

    async def get_transaction(self, transaction_id: str) -> EffectTransaction:
        async with self._lock:
            return deepcopy(self._tx[transaction_id])

    async def save_transaction(
        self,
        tx: EffectTransaction,
        *,
        expected_fence: int | None = None,
        evidence: EvidenceIntent | None = None,
    ) -> None:
        async with self._lock:
            old = self._tx[tx.transaction_id]
            for field in _IMMUTABLE_TX_FIELDS:
                if getattr(old, field) != getattr(tx, field):
                    raise ImmutableFieldViolation(field)
            if tx.fencing_epoch != old.fencing_epoch:
                raise FencingEpochViolation(
                    f"generic write cannot change fencing epoch "
                    f"{old.fencing_epoch} -> {tx.fencing_epoch}"
                )
            if expected_fence is not None and old.fencing_epoch != expected_fence:
                raise StaleFence(f"expected {expected_fence}, current {old.fencing_epoch}")
            validate_transaction_persistence(old, tx)
            tx.updated_at = datetime.now(UTC)
            self._tx[tx.transaction_id] = deepcopy(tx)
            self._enqueue_locked(tx.transaction_id, evidence)

    async def authorize_transaction(
        self,
        capability: ExecutionCapability,
        *,
        expected_fence: int | None = None,
        evidence: EvidenceIntent | None = None,
    ) -> EffectTransaction:
        async with self._lock:
            tx = self._tx[capability.transaction_id]
            if expected_fence is not None and tx.fencing_epoch != expected_fence:
                raise StaleFence(f"expected {expected_fence}, current {tx.fencing_epoch}")
            if tx.execution_state not in {ExecutionState.PREPARED, ExecutionState.AUTHORIZED}:
                raise CapabilityBindingMismatch("transaction is not prepared for authorization")
            if capability.subject != tx.intent.subject:
                raise CapabilityBindingMismatch("capability subject mismatch")
            if capability.action_digest != tx.action_digest:
                raise CapabilityBindingMismatch("capability action digest mismatch")

            for cap_id, (existing, status) in list(self._caps.items()):
                if (
                    existing.transaction_id == capability.transaction_id
                    and status == CapabilityStatus.ACTIVE
                ):
                    self._caps[cap_id] = (existing, CapabilityStatus.REVOKED)

            self._caps[capability.capability_id] = (capability, CapabilityStatus.ACTIVE)
            tx.capability_id = capability.capability_id
            tx.authorization_policy_version = capability.policy_version
            tx.approval_digest = capability.approval_digest
            apply_transaction_transition(tx, TransitionCommand.AUTHORIZE)
            tx.updated_at = datetime.now(UTC)
            self._tx[tx.transaction_id] = deepcopy(tx)
            self._enqueue_locked(
                tx.transaction_id,
                evidence,
                extra_payload={"capability_id": capability.capability_id},
            )
            return deepcopy(tx)

    async def consume_capability_and_start(
        self,
        *,
        capability_id: str,
        transaction_id: str,
        executor: str,
        worker_id: str = "engine",
        lease_seconds: int = 30,
        workload_credential_id: str | None = None,
        workload_identity_digest: str | None = None,
        evidence: EvidenceIntent | None = None,
    ) -> ExecutionAttempt:
        if lease_seconds < 1:
            raise ValueError("lease_seconds must be >= 1")
        async with self._lock:
            capability, status = self._caps[capability_id]
            if status == CapabilityStatus.CONSUMED:
                raise CapabilityConsumed(capability_id)
            if status == CapabilityStatus.REVOKED:
                raise CapabilityRevoked(capability_id)
            if status == CapabilityStatus.EXPIRED or capability.expires_at <= datetime.now(UTC):
                self._caps[capability_id] = (capability, CapabilityStatus.EXPIRED)
                raise CapabilityExpired(capability_id)

            tx = self._tx[transaction_id]
            if capability.transaction_id != transaction_id:
                raise CapabilityBindingMismatch("capability belongs to another transaction")
            if tx.capability_id != capability_id:
                raise CapabilityBindingMismatch("capability is not the transaction's active grant")
            if tx.execution_state != ExecutionState.AUTHORIZED:
                raise CapabilityBindingMismatch("transaction is not in AUTHORIZED state")
            if capability.subject != tx.intent.subject:
                raise CapabilityBindingMismatch("capability subject mismatch")
            if capability.action_digest != tx.action_digest:
                raise CapabilityBindingMismatch("capability action digest mismatch")
            if capability.executor != executor:
                raise CapabilityBindingMismatch("capability executor mismatch")
            if capability.policy_version != tx.authorization_policy_version:
                raise CapabilityBindingMismatch("capability policy version mismatch")
            if capability.approval_digest != tx.approval_digest:
                raise CapabilityBindingMismatch("capability approval mismatch")

            now = datetime.now(UTC)
            self._caps[capability_id] = (capability, CapabilityStatus.CONSUMED)
            tx.fencing_epoch += 1
            apply_transaction_transition(tx, TransitionCommand.START)
            attempt = ExecutionAttempt(
                transaction_id=transaction_id,
                executor=executor,
                fencing_epoch=tx.fencing_epoch,
                lease_owner=worker_id,
                lease_expires_at=now + timedelta(seconds=lease_seconds),
                started_at=now,
                workload_credential_id=workload_credential_id,
                workload_identity_digest=workload_identity_digest,
            )
            tx.latest_attempt_id = attempt.attempt_id
            tx.updated_at = now
            self._attempts[attempt.attempt_id] = deepcopy(attempt)
            self._tx[transaction_id] = deepcopy(tx)
            self._enqueue_locked(
                transaction_id,
                evidence,
                extra_payload={
                    "attempt_id": attempt.attempt_id,
                    "fence": attempt.fencing_epoch,
                    "lease_owner": attempt.lease_owner,
                    "lease_expires_at": attempt.lease_expires_at.isoformat(),
                    "workload_credential_id": attempt.workload_credential_id,
                    "workload_identity_digest": attempt.workload_identity_digest,
                },
            )
            return deepcopy(attempt)

    async def recover_orphaned_started(
        self,
        transaction_id: str,
        *,
        now: datetime | None = None,
        evidence: EvidenceIntent | None = None,
    ) -> EffectTransaction:
        now = now or datetime.now(UTC)
        async with self._lock:
            tx = self._tx[transaction_id]
            if tx.execution_state != ExecutionState.STARTED:
                raise ValueError("orphan recovery only applies to STARTED transactions")
            if not tx.latest_attempt_id:
                raise ValueError("STARTED transaction has no execution attempt")
            attempt = self._attempts[tx.latest_attempt_id]
            if attempt.state != AttemptState.ACTIVE:
                raise ValueError("latest attempt is not active")
            if attempt.fencing_epoch != tx.fencing_epoch:
                raise StaleFence(
                    f"attempt fence {attempt.fencing_epoch} does not match transaction "
                    f"{tx.fencing_epoch}"
                )
            if now < attempt.lease_expires_at:
                raise LeaseNotExpired(attempt.attempt_id)

            tx.fencing_epoch += 1
            apply_transaction_transition(tx, TransitionCommand.RECOVER_ORPHAN)
            tx.updated_at = now
            attempt.state = AttemptState.ORPHANED
            attempt.recovered_at = now
            attempt.finished_at = now
            self._attempts[attempt.attempt_id] = deepcopy(attempt)
            self._tx[transaction_id] = deepcopy(tx)
            self._enqueue_locked(
                transaction_id,
                evidence,
                extra_payload={
                    "execution_state": tx.execution_state.value,
                    "new_fence": tx.fencing_epoch,
                    "attempt_id": tx.latest_attempt_id,
                },
            )
            return deepcopy(tx)

    async def finalize_attempt_transition(
        self,
        tx: EffectTransaction,
        *,
        attempt_id: str,
        expected_fence: int,
        worker_id: str,
        attempt_state: AttemptState,
        evidence: EvidenceIntent | None = None,
    ) -> None:
        if attempt_state == AttemptState.ACTIVE:
            raise ValueError("terminal attempt state required")
        async with self._lock:
            old = self._tx[tx.transaction_id]
            for field in _IMMUTABLE_TX_FIELDS:
                if getattr(old, field) != getattr(tx, field):
                    raise ImmutableFieldViolation(field)
            if tx.fencing_epoch != old.fencing_epoch:
                raise FencingEpochViolation(
                    f"finalization cannot change fencing epoch "
                    f"{old.fencing_epoch} -> {tx.fencing_epoch}"
                )
            if old.fencing_epoch != expected_fence:
                raise StaleFence(f"expected {expected_fence}, current {old.fencing_epoch}")
            attempt = self._attempts[attempt_id]
            if attempt.transaction_id != tx.transaction_id:
                raise ValueError("attempt belongs to another transaction")
            if attempt.fencing_epoch != expected_fence:
                raise StaleFence(
                    f"attempt fence {attempt.fencing_epoch} does not match current {expected_fence}"
                )
            if attempt.lease_owner != worker_id:
                raise StaleAttemptOwner(
                    f"attempt is owned by {attempt.lease_owner}, not {worker_id}"
                )
            if attempt.state != AttemptState.ACTIVE:
                raise InvalidAttemptState(
                    f"attempt {attempt_id} is {attempt.state.value}, not active"
                )
            validate_transaction_persistence(old, tx)
            tx.updated_at = datetime.now(UTC)
            attempt.state = attempt_state
            attempt.finished_at = attempt.finished_at or datetime.now(UTC)
            self._tx[tx.transaction_id] = deepcopy(tx)
            self._attempts[attempt_id] = deepcopy(attempt)
            self._enqueue_locked(tx.transaction_id, evidence)

    async def finalize_reconciliation_transition(
        self,
        tx: EffectTransaction,
        *,
        attempt_id: str,
        expected_fence: int,
        evidence: EvidenceIntent | None = None,
    ) -> None:
        async with self._lock:
            old = self._tx[tx.transaction_id]
            for field in _IMMUTABLE_TX_FIELDS:
                if getattr(old, field) != getattr(tx, field):
                    raise ImmutableFieldViolation(field)
            if tx.fencing_epoch != old.fencing_epoch:
                raise FencingEpochViolation(
                    f"finalization cannot change fencing epoch "
                    f"{old.fencing_epoch} -> {tx.fencing_epoch}"
                )
            if old.fencing_epoch != expected_fence:
                raise StaleFence(f"expected {expected_fence}, current {old.fencing_epoch}")
            if old.execution_state != ExecutionState.UNKNOWN:
                raise InvalidAttemptState("reconciliation settlement requires UNKNOWN transaction")
            if tx.execution_state not in {
                ExecutionState.RECONCILED,
                ExecutionState.PREPARED,
                ExecutionState.EXECUTION_FAILED,
            }:
                raise InvalidAttemptState(
                    f"invalid reconciliation target {tx.execution_state.value}"
                )
            attempt = self._attempts[attempt_id]
            if attempt.transaction_id != tx.transaction_id:
                raise ValueError("attempt belongs to another transaction")
            if attempt.state not in {AttemptState.UNKNOWN, AttemptState.ORPHANED}:
                raise InvalidAttemptState(
                    f"attempt {attempt_id} cannot reconcile from {attempt.state.value}"
                )
            validate_transaction_persistence(old, tx)
            tx.updated_at = datetime.now(UTC)
            attempt.state = AttemptState.RECONCILED
            attempt.finished_at = attempt.finished_at or datetime.now(UTC)
            self._tx[tx.transaction_id] = deepcopy(tx)
            self._attempts[attempt_id] = deepcopy(attempt)
            self._enqueue_locked(tx.transaction_id, evidence)

    async def complete_attempt(
        self,
        attempt_id: str,
        *,
        expected_fence: int,
        worker_id: str,
        state: AttemptState,
    ) -> None:
        if state == AttemptState.ACTIVE:
            raise ValueError("terminal attempt state required")
        async with self._lock:
            attempt = self._attempts[attempt_id]
            tx = self._tx[attempt.transaction_id]
            if tx.fencing_epoch != expected_fence or attempt.fencing_epoch != expected_fence:
                raise StaleFence(
                    f"expected {expected_fence}, transaction={tx.fencing_epoch}, "
                    f"attempt={attempt.fencing_epoch}"
                )
            if attempt.lease_owner != worker_id:
                raise StaleAttemptOwner(
                    f"attempt is owned by {attempt.lease_owner}, not {worker_id}"
                )
            if attempt.state != AttemptState.ACTIVE:
                raise InvalidAttemptState(
                    f"attempt {attempt_id} is {attempt.state.value}, not active"
                )
            attempt.state = state
            attempt.finished_at = datetime.now(UTC)
            self._attempts[attempt_id] = deepcopy(attempt)

    async def get_attempt(self, attempt_id: str) -> ExecutionAttempt:
        async with self._lock:
            return deepcopy(self._attempts[attempt_id])

    async def enqueue_evidence(
        self,
        transaction_id: str,
        evidence: EvidenceIntent,
    ) -> EvidenceOutboxItem:
        async with self._lock:
            item = self._enqueue_locked(transaction_id, evidence)
            assert item is not None
            return item

    async def claim_evidence(
        self,
        *,
        worker_id: str,
        lease_seconds: int = 30,
    ) -> EvidenceOutboxItem | None:
        if lease_seconds < 1:
            raise ValueError("lease_seconds must be >= 1")
        now = datetime.now(UTC)
        async with self._lock:
            for outbox_id in self._outbox_order:
                item = self._outbox[outbox_id]
                claim_expired = (
                    item.status == OutboxStatus.CLAIMED
                    and item.claim_expires_at is not None
                    and item.claim_expires_at <= now
                )
                if item.status != OutboxStatus.PENDING and not claim_expired:
                    continue
                item.status = OutboxStatus.CLAIMED
                item.claim_owner = worker_id
                item.claim_token = str(uuid4())
                item.claimed_at = now
                item.claim_expires_at = now + timedelta(seconds=lease_seconds)
                item.attempts += 1
                self._outbox[outbox_id] = deepcopy(item)
                return deepcopy(item)
            return None

    async def mark_evidence_delivered(
        self,
        outbox_id: str,
        *,
        worker_id: str,
        claim_token: str,
        event_id: str,
    ) -> None:
        async with self._lock:
            item = self._outbox[outbox_id]
            if item.status == OutboxStatus.DELIVERED:
                if item.delivered_event_id != event_id:
                    raise ValueError("outbox already delivered to a different event")
                return
            if (
                item.status != OutboxStatus.CLAIMED
                or item.claim_owner != worker_id
                or item.claim_token != claim_token
            ):
                raise StaleOutboxClaim("outbox claim token/owner no longer matches")
            item.status = OutboxStatus.DELIVERED
            item.delivered_at = datetime.now(UTC)
            item.delivered_event_id = event_id
            item.claim_expires_at = None
            item.claim_token = None
            self._outbox[outbox_id] = deepcopy(item)

    async def release_evidence_claim(
        self,
        outbox_id: str,
        *,
        worker_id: str,
        claim_token: str,
        error: str,
    ) -> None:
        async with self._lock:
            item = self._outbox[outbox_id]
            if (
                item.status != OutboxStatus.CLAIMED
                or item.claim_owner != worker_id
                or item.claim_token != claim_token
            ):
                return
            item.status = OutboxStatus.PENDING
            item.claim_owner = None
            item.claim_token = None
            item.claim_expires_at = None
            item.last_error = error
            self._outbox[outbox_id] = deepcopy(item)

    async def pending_evidence_count(self) -> int:
        now = datetime.now(UTC)
        async with self._lock:
            return sum(
                1
                for item in self._outbox.values()
                if item.status == OutboxStatus.PENDING
                or (
                    item.status == OutboxStatus.CLAIMED
                    and item.claim_expires_at is not None
                    and item.claim_expires_at <= now
                )
            )
    async def evidence_outbox_stats(self) -> EvidenceOutboxStats:
        now = datetime.now(UTC)
        async with self._lock:
            items = list(self._outbox.values())
            pending_items = [item for item in items if item.status == OutboxStatus.PENDING]
            claimed_items = [item for item in items if item.status == OutboxStatus.CLAIMED]
            expired_items = [
                item
                for item in claimed_items
                if item.claim_expires_at is not None and item.claim_expires_at <= now
            ]
            effective_pending = pending_items + expired_items
            oldest = min((item.created_at for item in effective_pending), default=None)
            return EvidenceOutboxStats(
                pending=len(pending_items),
                claimed=len(claimed_items),
                expired_claims=len(expired_items),
                delivered=sum(item.status == OutboxStatus.DELIVERED for item in items),
                redelivered=sum(item.attempts > 1 for item in items),
                failed=sum(item.last_error is not None for item in items),
                oldest_pending_age_seconds=(
                    max(0.0, (now - oldest).total_seconds()) if oldest is not None else None
                ),
                max_attempts=max((item.attempts for item in items), default=0),
            )

