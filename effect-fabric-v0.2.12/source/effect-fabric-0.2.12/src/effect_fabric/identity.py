from __future__ import annotations

import base64
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from pydantic import BaseModel, ConfigDict, Field

from .canonical import canonical_json, digest_document


def utcnow() -> datetime:
    return datetime.now(UTC)


class WorkloadCredential(BaseModel):
    """Authority-signed credential binding a worker key to one environment and release."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    credential_id: str = Field(default_factory=lambda: str(uuid4()))
    worker_id: str
    subject: str
    environment_id: str
    release_id: str
    worker_public_key: str
    issued_at: datetime = Field(default_factory=utcnow)
    expires_at: datetime
    authority_key_id: str
    signature: str

    @property
    def digest(self) -> str:
        return digest_document(self.model_dump(mode="json"))


class WorkloadAssertion(BaseModel):
    """Worker-signed statement made under an authority-signed workload credential."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    assertion_id: str = Field(default_factory=lambda: str(uuid4()))
    credential: WorkloadCredential
    kind: str
    transaction_id: str
    action_digest: str
    executor: str
    worker_id: str
    environment_id: str
    release_id: str
    attempt_id: str | None = None
    fencing_epoch: int | None = Field(default=None, ge=1)
    outcome: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    asserted_at: datetime = Field(default_factory=utcnow)
    signature: str

    @property
    def digest(self) -> str:
        return digest_document(self.model_dump(mode="json"))


class WorkloadAuthority:
    """Issues short-lived worker credentials. Private keys are intentionally injectable."""

    def __init__(
        self,
        private_key: Ed25519PrivateKey | None = None,
        *,
        key_id: str = "workload-dev-authority",
    ) -> None:
        self.private = private_key or Ed25519PrivateKey.generate()
        self.public: Ed25519PublicKey = self.private.public_key()
        self.key_id = key_id

    def public_key_b64(self) -> str:
        raw = self.public.public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
        return base64.b64encode(raw).decode("ascii")

    def private_key_bytes(self) -> bytes:
        return self.private.private_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PrivateFormat.Raw,
            encryption_algorithm=serialization.NoEncryption(),
        )

    @classmethod
    def from_private_bytes(cls, value: bytes, *, key_id: str) -> "WorkloadAuthority":
        return cls(Ed25519PrivateKey.from_private_bytes(value), key_id=key_id)

    def issue(
        self,
        *,
        worker_id: str,
        subject: str,
        environment_id: str,
        release_id: str,
        worker_public_key: str,
        ttl_seconds: int = 300,
    ) -> WorkloadCredential:
        if ttl_seconds < 1:
            raise ValueError("ttl_seconds must be >= 1")
        issued_at = utcnow()
        credential = WorkloadCredential(
            credential_id=str(uuid4()),
            worker_id=worker_id,
            subject=subject,
            environment_id=environment_id,
            release_id=release_id,
            worker_public_key=worker_public_key,
            issued_at=issued_at,
            expires_at=issued_at + timedelta(seconds=ttl_seconds),
            authority_key_id=self.key_id,
            signature="",
        )
        body = credential.model_dump(mode="json", exclude={"signature"})
        signature = base64.b64encode(self.private.sign(canonical_json(body))).decode("ascii")
        return credential.model_copy(update={"signature": signature})



class WorkloadSigner:
    """Holds the per-worker key and signs transaction/attempt assertions."""

    def __init__(self, private_key: Ed25519PrivateKey, credential: WorkloadCredential) -> None:
        self.private = private_key
        self.public = private_key.public_key()
        self.credential = credential
        public_b64 = self.public_key_b64()
        if public_b64 != credential.worker_public_key:
            raise ValueError("worker private key does not match credential")

    @classmethod
    def enroll(
        cls,
        authority: WorkloadAuthority,
        *,
        worker_id: str,
        subject: str,
        environment_id: str,
        release_id: str,
        ttl_seconds: int = 300,
    ) -> "WorkloadSigner":
        private = Ed25519PrivateKey.generate()
        public = private.public_key().public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
        credential = authority.issue(
            worker_id=worker_id,
            subject=subject,
            environment_id=environment_id,
            release_id=release_id,
            worker_public_key=base64.b64encode(public).decode("ascii"),
            ttl_seconds=ttl_seconds,
        )
        return cls(private, credential)

    def public_key_b64(self) -> str:
        raw = self.public.public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
        return base64.b64encode(raw).decode("ascii")

    def sign(
        self,
        *,
        kind: str,
        transaction_id: str,
        action_digest: str,
        executor: str,
        attempt_id: str | None = None,
        fencing_epoch: int | None = None,
        outcome: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> WorkloadAssertion:
        assertion = WorkloadAssertion(
            assertion_id=str(uuid4()),
            credential=self.credential,
            kind=kind,
            transaction_id=transaction_id,
            action_digest=action_digest,
            executor=executor,
            worker_id=self.credential.worker_id,
            environment_id=self.credential.environment_id,
            release_id=self.credential.release_id,
            attempt_id=attempt_id,
            fencing_epoch=fencing_epoch,
            outcome=outcome,
            metadata=metadata or {},
            asserted_at=utcnow(),
            signature="",
        )
        body = assertion.model_dump(mode="json", exclude={"signature"})
        signature = base64.b64encode(self.private.sign(canonical_json(body))).decode("ascii")
        return assertion.model_copy(update={"signature": signature})



class WorkloadVerifier:
    """Verifies authority credentials and the per-worker assertions they authorize."""

    def __init__(self, authority_keys: dict[str, Ed25519PublicKey] | None = None) -> None:
        self._authority_keys = dict(authority_keys or {})

    @classmethod
    def from_authority(cls, authority: WorkloadAuthority) -> "WorkloadVerifier":
        return cls({authority.key_id: authority.public})

    def add_authority_key(self, key_id: str, public_key: Ed25519PublicKey) -> None:
        existing = self._authority_keys.get(key_id)
        if existing is not None:
            left = existing.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
            right = public_key.public_bytes(
                serialization.Encoding.Raw,
                serialization.PublicFormat.Raw,
            )
            if left != right:
                raise ValueError(f"authority key_id {key_id!r} already maps to another key")
        self._authority_keys[key_id] = public_key

    def verify_credential(
        self,
        credential: WorkloadCredential,
        *,
        now: datetime | None = None,
        expected_worker_id: str | None = None,
        expected_subject: str | None = None,
        expected_environment_id: str | None = None,
        expected_release_id: str | None = None,
    ) -> None:
        key = self._authority_keys.get(credential.authority_key_id)
        if key is None:
            raise KeyError(f"unknown workload authority key {credential.authority_key_id}")
        body = credential.model_dump(mode="json", exclude={"signature"})
        key.verify(base64.b64decode(credential.signature), canonical_json(body))
        current = now or utcnow()
        if credential.expires_at <= current:
            raise ValueError("workload credential expired")
        if credential.issued_at > current:
            raise ValueError("workload credential issued in the future")
        expected = {
            "worker_id": expected_worker_id,
            "subject": expected_subject,
            "environment_id": expected_environment_id,
            "release_id": expected_release_id,
        }
        for field, value in expected.items():
            if value is not None and getattr(credential, field) != value:
                raise ValueError(f"workload credential {field} mismatch")

    def verify_assertion(
        self,
        assertion: WorkloadAssertion,
        *,
        now: datetime | None = None,
        expected_kind: str | None = None,
        expected_transaction_id: str | None = None,
        expected_action_digest: str | None = None,
        expected_executor: str | None = None,
        expected_worker_id: str | None = None,
        expected_subject: str | None = None,
        expected_environment_id: str | None = None,
        expected_release_id: str | None = None,
        expected_attempt_id: str | None = None,
        expected_fencing_epoch: int | None = None,
    ) -> None:
        self.verify_credential(
            assertion.credential,
            now=now,
            expected_worker_id=expected_worker_id,
            expected_subject=expected_subject,
            expected_environment_id=expected_environment_id,
            expected_release_id=expected_release_id,
        )
        if assertion.worker_id != assertion.credential.worker_id:
            raise ValueError("assertion worker does not match credential")
        if assertion.environment_id != assertion.credential.environment_id:
            raise ValueError("assertion environment does not match credential")
        if assertion.release_id != assertion.credential.release_id:
            raise ValueError("assertion release does not match credential")
        worker_key = Ed25519PublicKey.from_public_bytes(
            base64.b64decode(assertion.credential.worker_public_key)
        )
        body = assertion.model_dump(mode="json", exclude={"signature"})
        worker_key.verify(base64.b64decode(assertion.signature), canonical_json(body))
        expected = {
            "kind": expected_kind,
            "transaction_id": expected_transaction_id,
            "action_digest": expected_action_digest,
            "executor": expected_executor,
            "worker_id": expected_worker_id,
            "environment_id": expected_environment_id,
            "release_id": expected_release_id,
            "attempt_id": expected_attempt_id,
            "fencing_epoch": expected_fencing_epoch,
        }
        for field, value in expected.items():
            if value is not None and getattr(assertion, field) != value:
                raise ValueError(f"workload assertion {field} mismatch")
        current = now or utcnow()
        if assertion.asserted_at > current:
            raise ValueError("workload assertion issued in the future")
        if assertion.asserted_at < assertion.credential.issued_at:
            raise ValueError("workload assertion predates credential")
        if assertion.asserted_at >= assertion.credential.expires_at:
            raise ValueError("workload assertion was made after credential expiry")
