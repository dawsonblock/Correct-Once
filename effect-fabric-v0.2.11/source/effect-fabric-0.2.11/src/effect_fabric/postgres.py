"""Optional PostgreSQL store.

Install ``effect-fabric[postgres]``. Security-critical transitions and their evidence intents are
committed in the same PostgreSQL transaction. Final hash-chain materialization is performed by the
transactional outbox dispatcher and is idempotent by outbox id.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
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
from .store import _IMMUTABLE_TX_FIELDS
from .transition_kernel import (
    TransitionCommand,
    apply_transaction_transition,
    validate_transaction_persistence,
)

try:  # optional dependency
    import psycopg
    from psycopg.rows import dict_row
    from psycopg.types.json import Jsonb
except ImportError:  # pragma: no cover
    psycopg = None
    dict_row = None
    Jsonb = None


def _jsonb(value: object) -> Any:
    if Jsonb is None:  # pragma: no cover - guarded by connect/constructor in normal use
        raise RuntimeError("install effect-fabric[postgres]")
    return Jsonb(value)


class PostgresStore:
    def __init__(self, conn: Any):
        self.conn = conn
        if dict_row is not None:
            self.conn.row_factory = dict_row

    @classmethod
    async def connect(cls, dsn: str) -> "PostgresStore":
        if psycopg is None or dict_row is None or Jsonb is None:  # pragma: no cover
            raise RuntimeError("install effect-fabric[postgres]")
        conn = await psycopg.AsyncConnection.connect(dsn, row_factory=dict_row)
        return cls(conn)

    async def close(self) -> None:
        await self.conn.close()

    async def _enqueue_evidence_in_tx(
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
        await self.conn.execute(
            """INSERT INTO effect_evidence_outbox
               (outbox_id, transaction_id, event_type, payload, status, created_at, attempts)
               VALUES (%s,%s,%s,%s,%s,%s,%s)""",
            (
                item.outbox_id,
                item.transaction_id,
                item.event_type,
                _jsonb(item.payload),
                item.status.value,
                item.created_at,
                item.attempts,
            ),
        )
        return item

    async def create_transaction(
        self,
        tx: EffectTransaction,
        *,
        evidence: EvidenceIntent | None = None,
    ) -> EffectTransaction:
        if tx.fencing_epoch != 0:
            raise FencingEpochViolation("new transactions must start at fencing epoch 0")
        async with self.conn.transaction():
            row = await (
                await self.conn.execute(
                    """SELECT action_digest, document
                       FROM effect_transactions
                       WHERE idempotency_key=%s FOR UPDATE""",
                    (tx.idempotency.key,),
                )
            ).fetchone()
            if row:
                if row["action_digest"] != tx.action_digest:
                    raise DuplicateIdempotencyConflict(tx.idempotency.key)
                return EffectTransaction.model_validate(row["document"])
            await self.conn.execute(
                """
                INSERT INTO effect_transactions
                  (transaction_id, action_digest, idempotency_key, intent, effect_contract,
                   idempotency_contract, reversibility_spec, execution_state, verification_state,
                   recovery_state, fencing_epoch, document)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    tx.transaction_id,
                    tx.action_digest,
                    tx.idempotency.key,
                    _jsonb(tx.intent.model_dump(mode="json")),
                    _jsonb(tx.contract.model_dump(mode="json")),
                    _jsonb(tx.idempotency.model_dump(mode="json")),
                    _jsonb(tx.reversibility.model_dump(mode="json")),
                    tx.execution_state.value,
                    tx.verification_state.value,
                    tx.recovery_state.value,
                    tx.fencing_epoch,
                    _jsonb(tx.model_dump(mode="json")),
                ),
            )
            await self._enqueue_evidence_in_tx(tx.transaction_id, evidence)
        return tx.model_copy(deep=True)

    async def get_transaction(self, transaction_id: str) -> EffectTransaction:
        row = await (
            await self.conn.execute(
                "SELECT document FROM effect_transactions WHERE transaction_id=%s",
                (transaction_id,),
            )
        ).fetchone()
        if not row:
            raise KeyError(transaction_id)
        return EffectTransaction.model_validate(row["document"])

    async def save_transaction(
        self,
        tx: EffectTransaction,
        *,
        expected_fence: int | None = None,
        evidence: EvidenceIntent | None = None,
    ) -> None:
        async with self.conn.transaction():
            row = await (
                await self.conn.execute(
                    """SELECT fencing_epoch, document
                       FROM effect_transactions
                       WHERE transaction_id=%s FOR UPDATE""",
                    (tx.transaction_id,),
                )
            ).fetchone()
            if not row:
                raise KeyError(tx.transaction_id)
            old = EffectTransaction.model_validate(row["document"])
            for field in _IMMUTABLE_TX_FIELDS:
                if getattr(old, field) != getattr(tx, field):
                    raise ImmutableFieldViolation(field)
            if tx.fencing_epoch != old.fencing_epoch:
                raise FencingEpochViolation(
                    f"generic write cannot change fencing epoch "
                    f"{old.fencing_epoch} -> {tx.fencing_epoch}"
                )
            if expected_fence is not None and row["fencing_epoch"] != expected_fence:
                raise StaleFence(f"expected {expected_fence}, current {row['fencing_epoch']}")
            validate_transaction_persistence(old, tx)
            tx.updated_at = datetime.now(UTC)
            await self._update_transaction(tx)
            await self._enqueue_evidence_in_tx(tx.transaction_id, evidence)

    async def _update_transaction(self, tx: EffectTransaction) -> None:
        await self.conn.execute(
            """UPDATE effect_transactions
               SET execution_state=%s, verification_state=%s, recovery_state=%s,
                   fencing_epoch=%s, capability_id=%s, prepared=%s, receipt=%s,
                   attestation=%s, updated_at=%s, document=%s
               WHERE transaction_id=%s""",
            (
                tx.execution_state.value,
                tx.verification_state.value,
                tx.recovery_state.value,
                tx.fencing_epoch,
                tx.capability_id,
                _jsonb(tx.prepared.model_dump(mode="json")) if tx.prepared else None,
                _jsonb(tx.receipt.model_dump(mode="json")) if tx.receipt else None,
                _jsonb(tx.attestation.model_dump(mode="json")) if tx.attestation else None,
                tx.updated_at,
                _jsonb(tx.model_dump(mode="json")),
                tx.transaction_id,
            ),
        )

    async def authorize_transaction(
        self,
        capability: ExecutionCapability,
        *,
        expected_fence: int | None = None,
        evidence: EvidenceIntent | None = None,
    ) -> EffectTransaction:
        async with self.conn.transaction():
            row = await (
                await self.conn.execute(
                    """SELECT fencing_epoch, document
                       FROM effect_transactions
                       WHERE transaction_id=%s FOR UPDATE""",
                    (capability.transaction_id,),
                )
            ).fetchone()
            if not row:
                raise KeyError(capability.transaction_id)
            tx = EffectTransaction.model_validate(row["document"])
            if expected_fence is not None and row["fencing_epoch"] != expected_fence:
                raise StaleFence(f"expected {expected_fence}, current {row['fencing_epoch']}")
            if tx.execution_state not in {ExecutionState.PREPARED, ExecutionState.AUTHORIZED}:
                raise CapabilityBindingMismatch("transaction is not prepared for authorization")
            if capability.subject != tx.intent.subject:
                raise CapabilityBindingMismatch("capability subject mismatch")
            if capability.action_digest != tx.action_digest:
                raise CapabilityBindingMismatch("capability action digest mismatch")

            await self.conn.execute(
                """UPDATE execution_capabilities
                   SET status=%s, revoked_at=now()
                   WHERE transaction_id=%s AND status=%s""",
                (
                    CapabilityStatus.REVOKED.value,
                    capability.transaction_id,
                    CapabilityStatus.ACTIVE.value,
                ),
            )
            await self.conn.execute(
                """INSERT INTO execution_capabilities
                   (capability_id, transaction_id, action_digest, subject, executor,
                    expires_at, status, document)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                (
                    capability.capability_id,
                    capability.transaction_id,
                    capability.action_digest,
                    capability.subject,
                    capability.executor,
                    capability.expires_at,
                    CapabilityStatus.ACTIVE.value,
                    _jsonb(capability.model_dump(mode="json")),
                ),
            )
            tx.capability_id = capability.capability_id
            tx.authorization_policy_version = capability.policy_version
            tx.approval_digest = capability.approval_digest
            apply_transaction_transition(tx, TransitionCommand.AUTHORIZE)
            tx.updated_at = datetime.now(UTC)
            await self._update_transaction(tx)
            await self._enqueue_evidence_in_tx(
                tx.transaction_id,
                evidence,
                extra_payload={"capability_id": capability.capability_id},
            )
            return tx.model_copy(deep=True)

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
        async with self.conn.transaction():
            cap_row = await (
                await self.conn.execute(
                    """SELECT transaction_id, action_digest, subject, executor, expires_at,
                              status, document
                       FROM execution_capabilities
                       WHERE capability_id=%s FOR UPDATE""",
                    (capability_id,),
                )
            ).fetchone()
            if not cap_row:
                raise KeyError(capability_id)
            capability = ExecutionCapability.model_validate(cap_row["document"])
            status = CapabilityStatus(cap_row["status"])
            if status == CapabilityStatus.CONSUMED:
                raise CapabilityConsumed(capability_id)
            if status == CapabilityStatus.REVOKED:
                raise CapabilityRevoked(capability_id)
            if status == CapabilityStatus.EXPIRED or cap_row["expires_at"] <= datetime.now(UTC):
                raise CapabilityExpired(capability_id)

            tx_row = await (
                await self.conn.execute(
                    """SELECT fencing_epoch, capability_id, execution_state, action_digest,
                              document
                       FROM effect_transactions
                       WHERE transaction_id=%s FOR UPDATE""",
                    (transaction_id,),
                )
            ).fetchone()
            if not tx_row:
                raise KeyError(transaction_id)
            tx = EffectTransaction.model_validate(tx_row["document"])

            if str(cap_row["transaction_id"]) != transaction_id:
                raise CapabilityBindingMismatch("capability belongs to another transaction")
            if str(tx_row["capability_id"]) != capability_id:
                raise CapabilityBindingMismatch("capability is not the active transaction grant")
            if tx_row["execution_state"] != ExecutionState.AUTHORIZED.value:
                raise CapabilityBindingMismatch("transaction is not AUTHORIZED")
            if cap_row["subject"] != tx.intent.subject:
                raise CapabilityBindingMismatch("capability subject mismatch")
            if cap_row["action_digest"] != tx.action_digest:
                raise CapabilityBindingMismatch("capability action digest mismatch")
            if cap_row["executor"] != executor:
                raise CapabilityBindingMismatch("capability executor mismatch")
            if capability.policy_version != tx.authorization_policy_version:
                raise CapabilityBindingMismatch("capability policy version mismatch")
            if capability.approval_digest != tx.approval_digest:
                raise CapabilityBindingMismatch("capability approval mismatch")

            now = datetime.now(UTC)
            epoch = int(tx_row["fencing_epoch"]) + 1
            attempt = ExecutionAttempt(
                transaction_id=transaction_id,
                executor=executor,
                fencing_epoch=epoch,
                lease_owner=worker_id,
                lease_expires_at=now + timedelta(seconds=lease_seconds),
                started_at=now,
                workload_credential_id=workload_credential_id,
                workload_identity_digest=workload_identity_digest,
            )
            tx.fencing_epoch = epoch
            apply_transaction_transition(tx, TransitionCommand.START)
            tx.latest_attempt_id = attempt.attempt_id
            tx.updated_at = now

            await self.conn.execute(
                """UPDATE execution_capabilities
                   SET status=%s, consumed_at=now()
                   WHERE capability_id=%s""",
                (CapabilityStatus.CONSUMED.value, capability_id),
            )
            await self.conn.execute(
                """INSERT INTO execution_attempts
                   (attempt_id, transaction_id, executor, fencing_epoch, lease_owner,
                    lease_expires_at, state, started_at, workload_credential_id,
                    workload_identity_digest)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (
                    attempt.attempt_id,
                    transaction_id,
                    executor,
                    epoch,
                    worker_id,
                    attempt.lease_expires_at,
                    attempt.state.value,
                    attempt.started_at,
                    attempt.workload_credential_id,
                    attempt.workload_identity_digest,
                ),
            )
            await self._update_transaction(tx)
            await self._enqueue_evidence_in_tx(
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
            return attempt

    async def recover_orphaned_started(
        self,
        transaction_id: str,
        *,
        now: datetime | None = None,
        evidence: EvidenceIntent | None = None,
    ) -> EffectTransaction:
        now = now or datetime.now(UTC)
        async with self.conn.transaction():
            tx_row = await (
                await self.conn.execute(
                    """SELECT fencing_epoch, execution_state, document
                       FROM effect_transactions
                       WHERE transaction_id=%s FOR UPDATE""",
                    (transaction_id,),
                )
            ).fetchone()
            if not tx_row:
                raise KeyError(transaction_id)
            tx = EffectTransaction.model_validate(tx_row["document"])
            if tx.execution_state != ExecutionState.STARTED:
                raise ValueError("orphan recovery only applies to STARTED transactions")
            if not tx.latest_attempt_id:
                raise ValueError("STARTED transaction has no execution attempt")
            attempt_row = await (
                await self.conn.execute(
                    """SELECT state, lease_expires_at, fencing_epoch, lease_owner
                       FROM execution_attempts
                       WHERE attempt_id=%s FOR UPDATE""",
                    (tx.latest_attempt_id,),
                )
            ).fetchone()
            if not attempt_row:
                raise KeyError(tx.latest_attempt_id)
            if AttemptState(attempt_row["state"]) != AttemptState.ACTIVE:
                raise ValueError("latest attempt is not active")
            if int(attempt_row["fencing_epoch"]) != int(tx_row["fencing_epoch"]):
                raise StaleFence(
                    f"attempt fence {attempt_row['fencing_epoch']} does not match transaction "
                    f"{tx_row['fencing_epoch']}"
                )
            if now < attempt_row["lease_expires_at"]:
                raise LeaseNotExpired(tx.latest_attempt_id)

            tx.fencing_epoch = int(tx_row["fencing_epoch"]) + 1
            apply_transaction_transition(tx, TransitionCommand.RECOVER_ORPHAN)
            tx.updated_at = now
            await self.conn.execute(
                """UPDATE execution_attempts
                   SET state=%s, recovered_at=%s, finished_at=%s
                   WHERE attempt_id=%s""",
                (AttemptState.ORPHANED.value, now, now, tx.latest_attempt_id),
            )
            await self._update_transaction(tx)
            await self._enqueue_evidence_in_tx(
                transaction_id,
                evidence,
                extra_payload={
                    "execution_state": tx.execution_state.value,
                    "new_fence": tx.fencing_epoch,
                    "attempt_id": tx.latest_attempt_id,
                },
            )
            return tx.model_copy(deep=True)

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
        async with self.conn.transaction():
            row = await (
                await self.conn.execute(
                    """SELECT t.fencing_epoch, t.document, a.transaction_id,
                              a.fencing_epoch AS attempt_fencing_epoch,
                              a.lease_owner, a.state AS attempt_state
                       FROM effect_transactions t
                       JOIN execution_attempts a ON a.transaction_id=t.transaction_id
                       WHERE t.transaction_id=%s AND a.attempt_id=%s
                       FOR UPDATE OF t, a""",
                    (tx.transaction_id, attempt_id),
                )
            ).fetchone()
            if not row:
                raise KeyError(attempt_id)
            if str(row["transaction_id"]) != tx.transaction_id:
                raise ValueError("attempt belongs to another transaction")
            old = EffectTransaction.model_validate(row["document"])
            for field in _IMMUTABLE_TX_FIELDS:
                if getattr(old, field) != getattr(tx, field):
                    raise ImmutableFieldViolation(field)
            if tx.fencing_epoch != old.fencing_epoch:
                raise FencingEpochViolation(
                    f"finalization cannot change fencing epoch "
                    f"{old.fencing_epoch} -> {tx.fencing_epoch}"
                )
            if int(row["fencing_epoch"]) != expected_fence:
                raise StaleFence(f"expected {expected_fence}, current {row['fencing_epoch']}")
            if int(row["attempt_fencing_epoch"]) != expected_fence:
                raise StaleFence(
                    f"attempt fence {row['attempt_fencing_epoch']} does not match current "
                    f"{expected_fence}"
                )
            if row["lease_owner"] != worker_id:
                raise StaleAttemptOwner(
                    f"attempt is owned by {row['lease_owner']}, not {worker_id}"
                )
            if AttemptState(row["attempt_state"]) != AttemptState.ACTIVE:
                raise InvalidAttemptState(
                    f"attempt {attempt_id} is {row['attempt_state']}, not active"
                )
            validate_transaction_persistence(old, tx)
            tx.updated_at = datetime.now(UTC)
            await self._update_transaction(tx)
            await self.conn.execute(
                """UPDATE execution_attempts
                   SET state=%s, finished_at=COALESCE(finished_at, now())
                   WHERE attempt_id=%s""",
                (attempt_state.value, attempt_id),
            )
            await self._enqueue_evidence_in_tx(tx.transaction_id, evidence)

    async def finalize_reconciliation_transition(
        self,
        tx: EffectTransaction,
        *,
        attempt_id: str,
        expected_fence: int,
        evidence: EvidenceIntent | None = None,
    ) -> None:
        async with self.conn.transaction():
            row = await (
                await self.conn.execute(
                    """SELECT t.fencing_epoch, t.document, a.transaction_id,
                              a.state AS attempt_state
                       FROM effect_transactions t
                       JOIN execution_attempts a ON a.transaction_id=t.transaction_id
                       WHERE t.transaction_id=%s AND a.attempt_id=%s
                       FOR UPDATE OF t, a""",
                    (tx.transaction_id, attempt_id),
                )
            ).fetchone()
            if not row:
                raise KeyError(attempt_id)
            if str(row["transaction_id"]) != tx.transaction_id:
                raise ValueError("attempt belongs to another transaction")
            old = EffectTransaction.model_validate(row["document"])
            for field in _IMMUTABLE_TX_FIELDS:
                if getattr(old, field) != getattr(tx, field):
                    raise ImmutableFieldViolation(field)
            if tx.fencing_epoch != old.fencing_epoch:
                raise FencingEpochViolation(
                    f"finalization cannot change fencing epoch "
                    f"{old.fencing_epoch} -> {tx.fencing_epoch}"
                )
            if int(row["fencing_epoch"]) != expected_fence:
                raise StaleFence(f"expected {expected_fence}, current {row['fencing_epoch']}")
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
            state = AttemptState(row["attempt_state"])
            if state not in {AttemptState.UNKNOWN, AttemptState.ORPHANED}:
                raise InvalidAttemptState(
                    f"attempt {attempt_id} cannot reconcile from {state.value}"
                )
            validate_transaction_persistence(old, tx)
            tx.updated_at = datetime.now(UTC)
            await self._update_transaction(tx)
            await self.conn.execute(
                """UPDATE execution_attempts
                   SET state=%s, finished_at=COALESCE(finished_at, now())
                   WHERE attempt_id=%s""",
                (AttemptState.RECONCILED.value, attempt_id),
            )
            await self._enqueue_evidence_in_tx(tx.transaction_id, evidence)

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
        async with self.conn.transaction():
            row = await (
                await self.conn.execute(
                    """SELECT a.transaction_id, a.fencing_epoch AS attempt_fencing_epoch,
                              a.lease_owner, a.state AS attempt_state, t.fencing_epoch
                       FROM execution_attempts a
                       JOIN effect_transactions t ON t.transaction_id=a.transaction_id
                       WHERE a.attempt_id=%s FOR UPDATE OF a, t""",
                    (attempt_id,),
                )
            ).fetchone()
            if not row:
                raise KeyError(attempt_id)
            if (
                int(row["fencing_epoch"]) != expected_fence
                or int(row["attempt_fencing_epoch"]) != expected_fence
            ):
                raise StaleFence(
                    f"expected {expected_fence}, transaction={row['fencing_epoch']}, "
                    f"attempt={row['attempt_fencing_epoch']}"
                )
            if row["lease_owner"] != worker_id:
                raise StaleAttemptOwner(
                    f"attempt is owned by {row['lease_owner']}, not {worker_id}"
                )
            if AttemptState(row["attempt_state"]) != AttemptState.ACTIVE:
                raise InvalidAttemptState(
                    f"attempt {attempt_id} is {row['attempt_state']}, not active"
                )
            await self.conn.execute(
                """UPDATE execution_attempts
                   SET state=%s, finished_at=COALESCE(finished_at, now())
                   WHERE attempt_id=%s""",
                (state.value, attempt_id),
            )

    async def get_attempt(self, attempt_id: str) -> ExecutionAttempt:
        row = await (
            await self.conn.execute(
                """SELECT attempt_id, transaction_id, executor, fencing_epoch, lease_owner,
                          lease_expires_at, state, started_at, finished_at, recovered_at,
                          workload_credential_id, workload_identity_digest
                   FROM execution_attempts WHERE attempt_id=%s""",
                (attempt_id,),
            )
        ).fetchone()
        if not row:
            raise KeyError(attempt_id)
        document = dict(row)
        document["attempt_id"] = str(document["attempt_id"])
        document["transaction_id"] = str(document["transaction_id"])
        return ExecutionAttempt.model_validate(document)

    async def enqueue_evidence(
        self,
        transaction_id: str,
        evidence: EvidenceIntent,
    ) -> EvidenceOutboxItem:
        async with self.conn.transaction():
            item = await self._enqueue_evidence_in_tx(transaction_id, evidence)
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
        expires = now + timedelta(seconds=lease_seconds)
        async with self.conn.transaction():
            row = await (
                await self.conn.execute(
                    """SELECT outbox_id, transaction_id, event_type, payload, status, created_at,
                              claimed_at, claim_owner, claim_token, claim_expires_at, delivered_at,
                              delivered_event_id, attempts, last_error
                       FROM effect_evidence_outbox
                       WHERE status=%s
                          OR (status=%s AND claim_expires_at <= %s)
                       ORDER BY created_at, outbox_id
                       FOR UPDATE SKIP LOCKED
                       LIMIT 1""",
                    (OutboxStatus.PENDING.value, OutboxStatus.CLAIMED.value, now),
                )
            ).fetchone()
            if not row:
                return None
            claim_token = str(uuid4())
            await self.conn.execute(
                """UPDATE effect_evidence_outbox
                   SET status=%s, claimed_at=%s, claim_owner=%s, claim_token=%s,
                       claim_expires_at=%s, attempts=attempts+1
                   WHERE outbox_id=%s""",
                (
                    OutboxStatus.CLAIMED.value,
                    now,
                    worker_id,
                    claim_token,
                    expires,
                    row["outbox_id"],
                ),
            )
            document = dict(row)
            document["outbox_id"] = str(document["outbox_id"])
            document["transaction_id"] = str(document["transaction_id"])
            if document.get("delivered_event_id") is not None:
                document["delivered_event_id"] = str(document["delivered_event_id"])
            document.update(
                {
                    "status": OutboxStatus.CLAIMED.value,
                    "claimed_at": now,
                    "claim_owner": worker_id,
                    "claim_token": claim_token,
                    "claim_expires_at": expires,
                    "attempts": int(row["attempts"]) + 1,
                }
            )
            return EvidenceOutboxItem.model_validate(document)

    async def mark_evidence_delivered(
        self,
        outbox_id: str,
        *,
        worker_id: str,
        claim_token: str,
        event_id: str,
    ) -> None:
        async with self.conn.transaction():
            row = await (
                await self.conn.execute(
                    """SELECT status, claim_owner, claim_token, delivered_event_id
                       FROM effect_evidence_outbox
                       WHERE outbox_id=%s FOR UPDATE""",
                    (outbox_id,),
                )
            ).fetchone()
            if not row:
                raise KeyError(outbox_id)
            status = OutboxStatus(row["status"])
            if status == OutboxStatus.DELIVERED:
                if str(row["delivered_event_id"]) != event_id:
                    raise ValueError("outbox already delivered to a different event")
                return
            if (
                status != OutboxStatus.CLAIMED
                or row["claim_owner"] != worker_id
                or str(row["claim_token"]) != claim_token
            ):
                raise StaleOutboxClaim("outbox claim token/owner no longer matches")
            await self.conn.execute(
                """UPDATE effect_evidence_outbox
                   SET status=%s, delivered_at=now(), delivered_event_id=%s,
                       claim_token=NULL, claim_expires_at=NULL, last_error=NULL
                   WHERE outbox_id=%s""",
                (OutboxStatus.DELIVERED.value, event_id, outbox_id),
            )

    async def release_evidence_claim(
        self,
        outbox_id: str,
        *,
        worker_id: str,
        claim_token: str,
        error: str,
    ) -> None:
        async with self.conn.transaction():
            await self.conn.execute(
                """UPDATE effect_evidence_outbox
                   SET status=%s, claim_owner=NULL, claim_token=NULL,
                       claim_expires_at=NULL, last_error=%s
                   WHERE outbox_id=%s AND status=%s AND claim_owner=%s AND claim_token=%s""",
                (
                    OutboxStatus.PENDING.value,
                    error,
                    outbox_id,
                    OutboxStatus.CLAIMED.value,
                    worker_id,
                    claim_token,
                ),
            )

    async def pending_evidence_count(self) -> int:
        row = await (
            await self.conn.execute(
                """SELECT count(*) AS count
                   FROM effect_evidence_outbox
                   WHERE status=%s
                      OR (status=%s AND claim_expires_at <= now())""",
                (OutboxStatus.PENDING.value, OutboxStatus.CLAIMED.value),
            )
        ).fetchone()
        return int(row["count"])
    async def evidence_outbox_stats(self) -> EvidenceOutboxStats:
        row = await (
            await self.conn.execute(
                """SELECT
                       count(*) FILTER (WHERE status=%s) AS pending,
                       count(*) FILTER (WHERE status=%s) AS claimed,
                       count(*) FILTER (WHERE status=%s AND claim_expires_at <= now())
                           AS expired_claims,
                       count(*) FILTER (WHERE status=%s) AS delivered,
                       count(*) FILTER (WHERE attempts > 1) AS redelivered,
                       count(*) FILTER (WHERE last_error IS NOT NULL) AS failed,
                       EXTRACT(EPOCH FROM (now() - min(created_at) FILTER (
                           WHERE status=%s OR (status=%s AND claim_expires_at <= now())
                       ))) AS oldest_pending_age_seconds,
                       COALESCE(max(attempts), 0) AS max_attempts
                   FROM effect_evidence_outbox""",
                (
                    OutboxStatus.PENDING.value,
                    OutboxStatus.CLAIMED.value,
                    OutboxStatus.CLAIMED.value,
                    OutboxStatus.DELIVERED.value,
                    OutboxStatus.PENDING.value,
                    OutboxStatus.CLAIMED.value,
                ),
            )
        ).fetchone()
        if row is None:  # pragma: no cover - aggregate always yields a row
            return EvidenceOutboxStats()
        age = row["oldest_pending_age_seconds"]
        return EvidenceOutboxStats(
            pending=int(row["pending"] or 0),
            claimed=int(row["claimed"] or 0),
            expired_claims=int(row["expired_claims"] or 0),
            delivered=int(row["delivered"] or 0),
            redelivered=int(row["redelivered"] or 0),
            failed=int(row["failed"] or 0),
            oldest_pending_age_seconds=float(age) if age is not None else None,
            max_attempts=int(row["max_attempts"] or 0),
        )

