"""External exact-action authorization evidence compatibility boundary.

Effect Fabric intentionally does not trust an upstream authorization system as its execution
capability.  It validates an external decision/evidence object, binds its digest into the local
transaction authorization record, then issues its own one-use transaction-bound capability.
"""
from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

from .canonical import digest_document


class ExternalDecision(StrEnum):
    ALLOW = "allow"
    DENY = "deny"
    REQUIRE_APPROVAL = "require_approval"


class ExternalAuthorizationEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: str = "effect-fabric/external-authorization/v1"
    issuer: str
    decision: ExternalDecision
    subject: str
    action_digest: str
    policy_version: str
    issued_at: datetime
    expires_at: datetime
    audience: str = "effect-fabric"
    approval_digest: str | None = None
    evidence_id: str
    signature_profile: str | None = None
    signature: str | None = None
    claims: dict[str, object] = Field(default_factory=dict)

    @property
    def digest(self) -> str:
        return digest_document(self.model_dump(mode="json"))

    def validate_binding(
        self,
        *,
        subject: str,
        action_digest: str,
        now: datetime,
        expected_audience: str = "effect-fabric",
    ) -> None:
        if self.decision is not ExternalDecision.ALLOW:
            raise PermissionError(f"external authorization is not ALLOW: {self.decision}")
        if self.subject != subject:
            raise PermissionError("external authorization subject mismatch")
        if self.action_digest != action_digest:
            raise PermissionError("external authorization action digest mismatch")
        if self.audience != expected_audience:
            raise PermissionError("external authorization audience mismatch")
        if now < self.issued_at:
            raise PermissionError("external authorization is not yet valid")
        if now >= self.expires_at:
            raise PermissionError("external authorization expired")
