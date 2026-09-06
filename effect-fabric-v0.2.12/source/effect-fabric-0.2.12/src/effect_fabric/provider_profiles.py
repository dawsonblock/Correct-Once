"""Provider effect profiles inspired by OpenOnce provider capabilities.

A profile captures what a provider can *honestly* prove after an ambiguous external call.  It keeps
provider-specific idempotency/reconciliation facts out of the generic engine.
"""
from __future__ import annotations

from enum import StrEnum
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .canonical import digest_document


class IdempotencyMode(StrEnum):
    NATIVE_PROVIDER_KEY = "native_provider_key"
    NATURAL_BUSINESS_KEY = "natural_business_key"
    SENDER_CONTROLLED_KEY = "sender_controlled_key"
    RECONCILE_ONLY = "reconcile_only"
    NONE = "none"


class OutcomeResolutionMode(StrEnum):
    STRONG_RECEIPT_FEED = "strong_receipt_feed"
    AUTHORITATIVE_PROBE = "authoritative_probe"
    ONE_SIDED_PROBE = "one_sided_probe"
    NONE = "none"


class ProbeMissMeaning(StrEnum):
    NOT_HAPPENED = "not_happened"
    INCONCLUSIVE = "inconclusive"


class ProviderEffectProfile(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: str = "effect-fabric/provider-profile/v1"
    profile_id: str
    tool_pattern: str
    idempotency_mode: IdempotencyMode
    resolution_mode: OutcomeResolutionMode
    miss_meaning: ProbeMissMeaning
    can_auto_rearm_on_miss: bool = False
    default_grace_ms: int = Field(default=0, ge=0)
    stable_key_fields: tuple[str, ...] = ()
    required_receipt_fields: tuple[str, ...] = ()
    authoritative_source: str | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def validate_honesty(self) -> Self:
        if self.resolution_mode is OutcomeResolutionMode.NONE:
            if self.miss_meaning is ProbeMissMeaning.NOT_HAPPENED:
                raise ValueError("provider without a resolver cannot treat a miss as not_happened")
            if self.can_auto_rearm_on_miss:
                raise ValueError("provider without a resolver cannot auto-rearm")
        if self.resolution_mode is OutcomeResolutionMode.ONE_SIDED_PROBE:
            if self.miss_meaning is ProbeMissMeaning.NOT_HAPPENED:
                raise ValueError("one-sided probe misses must remain inconclusive")
            if self.can_auto_rearm_on_miss:
                raise ValueError("one-sided probe cannot auto-rearm from a miss")
        if self.miss_meaning is ProbeMissMeaning.INCONCLUSIVE and self.can_auto_rearm_on_miss:
            raise ValueError("inconclusive misses cannot auto-rearm")
        if self.can_auto_rearm_on_miss and self.miss_meaning is not ProbeMissMeaning.NOT_HAPPENED:
            raise ValueError("auto-rearm requires an authoritative not_happened miss")
        return self

    @property
    def digest(self) -> str:
        return digest_document(self.model_dump(mode="json"))

    def permits_retry_after_miss(self) -> bool:
        return self.can_auto_rearm_on_miss and self.miss_meaning is ProbeMissMeaning.NOT_HAPPENED


STRONG_RECEIPT_PROFILE = ProviderEffectProfile(
    profile_id="strong-receipt-feed",
    tool_pattern="*",
    idempotency_mode=IdempotencyMode.NATIVE_PROVIDER_KEY,
    resolution_mode=OutcomeResolutionMode.STRONG_RECEIPT_FEED,
    miss_meaning=ProbeMissMeaning.NOT_HAPPENED,
    can_auto_rearm_on_miss=True,
    authoritative_source="authenticated settlement feed",
)
