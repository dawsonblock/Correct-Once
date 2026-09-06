from __future__ import annotations

from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any, Literal, Self
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .canonical import digest_document


def utcnow() -> datetime:
    return datetime.now(UTC)


def default_lease_expiry() -> datetime:
    return utcnow() + timedelta(seconds=30)


class ExecutionState(StrEnum):
    PLANNED = "planned"
    AUTHORIZED = "authorized"
    PREPARED = "prepared"
    STARTED = "started"
    RECEIPT_RECORDED = "receipt_recorded"
    RECONCILED = "reconciled"
    UNKNOWN = "unknown"
    EXECUTION_FAILED = "execution_failed"


class VerificationState(StrEnum):
    NOT_RUN = "not_run"
    VERIFYING = "verifying"
    VERIFIED = "verified"
    MISMATCH = "mismatch"
    INCONCLUSIVE = "inconclusive"


class RecoveryState(StrEnum):
    NONE = "none"
    AVAILABLE = "available"
    COMPENSATION_REQUIRED = "compensation_required"
    COMPENSATING = "compensating"
    COMPENSATED = "compensated"
    RECOVERY_FAILED = "recovery_failed"
    IRREVERSIBLE = "irreversible"


class ReversibilityClass(StrEnum):
    READ_ONLY = "read_only"
    NATIVELY_REVERSIBLE = "natively_reversible"
    COMPENSABLE = "compensable"
    IRREVERSIBLE = "irreversible"
    UNKNOWN = "unknown"


class CapabilityStatus(StrEnum):
    ACTIVE = "active"
    CONSUMED = "consumed"
    REVOKED = "revoked"
    EXPIRED = "expired"


class AttemptState(StrEnum):
    ACTIVE = "active"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    UNKNOWN = "unknown"
    ORPHANED = "orphaned"
    RECONCILED = "reconciled"


class ReconciliationStatus(StrEnum):
    HAPPENED = "happened"
    NOT_HAPPENED = "not_happened"
    UNKNOWN = "unknown"


class Predicate(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    path: str
    operator: Literal["eq", "ne", "contains", "not_contains", "exists", "not_exists"]
    value: Any = None


class EffectContract(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: str = "effect-contract/v1"
    resource: str
    preconditions: list[Predicate] = Field(default_factory=list)
    expected: list[Predicate] = Field(default_factory=list)
    forbidden: list[Predicate] = Field(default_factory=list)
    verifier: str
    max_verification_attempts: int = Field(default=3, ge=1, le=20)

    @property
    def digest(self) -> str:
        return digest_document(self.model_dump(mode="json"))


class IdempotencyContract(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    mechanism: Literal["provider_key", "natural_resource", "reconcile_only"]
    key: str
    retry_after_not_happened: bool = True
    retry_after_unknown: bool = False


class ReversibilitySpec(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    classification: ReversibilityClass
    recovery_operation: str | None = None
    qualification_id: str | None = None
    qualified_at: datetime | None = None
    expires_at: datetime | None = None

    @model_validator(mode="after")
    def require_recovery_for_compensable(self) -> Self:
        if self.classification in {
            ReversibilityClass.NATIVELY_REVERSIBLE,
            ReversibilityClass.COMPENSABLE,
        } and not self.recovery_operation:
            raise ValueError("reversible/compensable effects require recovery_operation")
        return self


class ActionIntent(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    protocol_version: str = "effect-fabric/v1"
    intent_id: str = Field(default_factory=lambda: str(uuid4()))
    subject: str
    operation: str
    resource: str
    arguments: dict[str, Any] = Field(default_factory=dict)
    requested_at: datetime = Field(default_factory=utcnow)
    deadline: datetime | None = None
    semantic_metadata: dict[str, str] | None = None
    trace_id: str | None = None
    parent_intent_id: str | None = None

    def action_digest(self, contract: EffectContract) -> str:
        body = {
            "protocol_version": self.protocol_version,
            "subject": self.subject,
            "operation": self.operation,
            "resource": self.resource,
            "arguments": self.arguments,
            "effect_contract_digest": contract.digest,
        }
        if self.semantic_metadata:
            body["semantic_metadata"] = self.semantic_metadata
        return digest_document(body)


class PreparedEffect(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    prepared_at: datetime = Field(default_factory=utcnow)
    observed_pre_state: dict[str, Any]
    external_version: str | None = None


class ExecutionCapability(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    capability_id: str = Field(default_factory=lambda: str(uuid4()))
    transaction_id: str
    subject: str
    action_digest: str
    executor: str
    issued_at: datetime = Field(default_factory=utcnow)
    expires_at: datetime
    uses: int = Field(default=1, ge=1, le=1)
    policy_version: str
    approval_digest: str | None = None
    key_id: str
    signature: str


class ExecutionAttempt(BaseModel):
    model_config = ConfigDict(extra="forbid")

    attempt_id: str = Field(default_factory=lambda: str(uuid4()))
    transaction_id: str
    executor: str
    fencing_epoch: int = Field(ge=1)
    lease_owner: str = "engine"
    lease_expires_at: datetime = Field(default_factory=default_lease_expiry)
    state: AttemptState = AttemptState.ACTIVE
    started_at: datetime = Field(default_factory=utcnow)
    finished_at: datetime | None = None
    recovered_at: datetime | None = None
    workload_credential_id: str | None = None
    workload_identity_digest: str | None = None


class ProviderReceipt(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    provider: str
    operation: str
    external_id: str | None = None
    status_code: int | None = None
    idempotency_key: str | None = None
    response_digest: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    recorded_at: datetime = Field(default_factory=utcnow)


class Observation(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    verifier: str
    resource: str
    state: dict[str, Any]
    external_version: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    observed_at: datetime = Field(default_factory=utcnow)


class OutcomeAttestation(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    verifier: str
    contract_digest: str
    state: VerificationState
    matched: list[str] = Field(default_factory=list)
    mismatched: list[str] = Field(default_factory=list)
    attempts: int = Field(default=1, ge=1)
    details: dict[str, Any] = Field(default_factory=dict)
    observed_at: datetime = Field(default_factory=utcnow)


class RecoveryPlan(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    recovery_operation: str
    arguments: dict[str, Any]
    restoration_contract: EffectContract


class EffectTransaction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    transaction_id: str = Field(default_factory=lambda: str(uuid4()))
    intent: ActionIntent
    contract: EffectContract
    idempotency: IdempotencyContract
    reversibility: ReversibilitySpec
    action_digest: str
    execution_state: ExecutionState = ExecutionState.PLANNED
    verification_state: VerificationState = VerificationState.NOT_RUN
    recovery_state: RecoveryState = RecoveryState.NONE
    capability_id: str | None = None
    authorization_policy_version: str | None = None
    approval_digest: str | None = None
    prepared: PreparedEffect | None = None
    latest_attempt_id: str | None = None
    receipt: ProviderReceipt | None = None
    attestation: OutcomeAttestation | None = None
    fencing_epoch: int = 0
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

    @model_validator(mode="after")
    def validate_digest(self) -> Self:
        expected = self.intent.action_digest(self.contract)
        if self.action_digest != expected:
            raise ValueError("transaction action_digest does not match intent+contract")
        return self
