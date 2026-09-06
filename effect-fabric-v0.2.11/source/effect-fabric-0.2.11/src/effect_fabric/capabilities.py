from __future__ import annotations

import base64
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

from .canonical import canonical_json
from .errors import (
    ActionDigestMismatch,
    CapabilityBindingMismatch,
    CapabilityExpired,
)
from .models import ExecutionCapability


class CapabilityAuthority:
    """Issues and verifies exact-action, transaction-bound capabilities.

    Store-side consumption still enforces active-capability identity and single-use semantics.
    The signature binds the capability to one transaction, subject, executor, action digest,
    policy version, approval digest, lifetime, and use count.
    """

    def __init__(
        self,
        private_key: Ed25519PrivateKey | None = None,
        key_id: str = "local-dev-key",
    ):
        self._private = private_key or Ed25519PrivateKey.generate()
        self._public = self._private.public_key()
        self.key_id = key_id

    @property
    def public_key(self) -> Ed25519PublicKey:
        return self._public

    @staticmethod
    def _unsigned_payload(cap: dict[str, object]) -> dict[str, object]:
        body = dict(cap)
        body.pop("signature", None)
        return body

    def issue(
        self,
        *,
        transaction_id: str,
        subject: str,
        action_digest: str,
        executor: str,
        policy_version: str = "dev/v1",
        ttl_seconds: int = 60,
        approval_digest: str | None = None,
    ) -> ExecutionCapability:
        now = datetime.now(UTC)
        capability_id = str(uuid4())
        expires_at = now + timedelta(seconds=ttl_seconds)
        unsigned = {
            "capability_id": capability_id,
            "transaction_id": transaction_id,
            "subject": subject,
            "action_digest": action_digest,
            "executor": executor,
            "issued_at": now,
            "expires_at": expires_at,
            "uses": 1,
            "policy_version": policy_version,
            "approval_digest": approval_digest,
            "key_id": self.key_id,
        }
        payload = canonical_json(_jsonable(unsigned))
        signature = base64.b64encode(self._private.sign(payload)).decode("ascii")
        return ExecutionCapability(
            capability_id=capability_id,
            transaction_id=transaction_id,
            subject=subject,
            action_digest=action_digest,
            executor=executor,
            issued_at=now,
            expires_at=expires_at,
            uses=1,
            policy_version=policy_version,
            approval_digest=approval_digest,
            key_id=self.key_id,
            signature=signature,
        )

    def verify(
        self,
        capability: ExecutionCapability,
        *,
        expected_digest: str,
        expected_transaction_id: str | None = None,
        expected_subject: str | None = None,
        expected_executor: str | None = None,
        now: datetime | None = None,
    ) -> None:
        now = now or datetime.now(UTC)
        if capability.expires_at <= now:
            raise CapabilityExpired(capability.capability_id)
        if capability.action_digest != expected_digest:
            raise ActionDigestMismatch(capability.capability_id)
        if (
            expected_transaction_id is not None
            and capability.transaction_id != expected_transaction_id
        ):
            raise CapabilityBindingMismatch("capability transaction mismatch")
        if expected_subject is not None and capability.subject != expected_subject:
            raise CapabilityBindingMismatch("capability subject mismatch")
        if expected_executor is not None and capability.executor != expected_executor:
            raise CapabilityBindingMismatch("capability executor mismatch")
        payload = canonical_json(_jsonable(self._unsigned_payload(capability.model_dump())))
        self._public.verify(base64.b64decode(capability.signature), payload)


def _jsonable(obj: object) -> object:
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {key: _jsonable(value) for key, value in obj.items()}
    if isinstance(obj, list):
        return [_jsonable(value) for value in obj]
    return obj
