from typing import Any

from enum import StrEnum


class EffectFabricError(Exception):
    """Base error."""


class AuthorizationError(EffectFabricError):
    pass


class CapabilityConsumed(AuthorizationError):
    pass


class CapabilityRevoked(AuthorizationError):
    pass


class CapabilityExpired(AuthorizationError):
    pass


class CapabilityBindingMismatch(AuthorizationError):
    pass


class ActionDigestMismatch(AuthorizationError):
    pass


class InvalidTransition(EffectFabricError):
    pass


class DuplicateIdempotencyConflict(EffectFabricError):
    pass


class ProviderErrorKind(StrEnum):
    DEFINITIVE_REJECTION = "definitive_rejection"
    RETRYABLE_PRE_EFFECT = "retryable_pre_effect"
    AMBIGUOUS_TRANSPORT = "ambiguous_transport"
    AUTHENTICATION = "authentication_failure"
    AUTHORIZATION = "authorization_failure"
    RATE_LIMITED = "rate_limited"
    INVALID_REQUEST = "invalid_request"
    PROVIDER_UNAVAILABLE = "provider_unavailable"
    PROTOCOL_VIOLATION = "protocol_violation"


class ProviderExecutionError(EffectFabricError):
    """Typed external-provider failure with explicit ambiguity semantics."""

    def __init__(
        self,
        message: str,
        *,
        kind: ProviderErrorKind,
        may_have_happened: bool,
        safe_to_retry: bool,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.kind = kind
        self.may_have_happened = may_have_happened
        self.safe_to_retry = safe_to_retry
        self.metadata = metadata or {}


class AmbiguousEffectError(ProviderExecutionError):
    """The external effect may have happened, but the caller cannot prove either outcome."""

    def __init__(
        self, message: str, *, metadata: dict[str, Any] | None = None
    ) -> None:
        super().__init__(
            message,
            kind=ProviderErrorKind.AMBIGUOUS_TRANSPORT,
            may_have_happened=True,
            safe_to_retry=False,
            metadata=metadata,
        )


class VerifierErrorKind(StrEnum):
    AUTHENTICATION = "authentication_failure"
    AUTHORIZATION = "authorization_failure"
    RATE_LIMITED = "rate_limited"
    PROVIDER_UNAVAILABLE = "provider_unavailable"
    STALE_OR_INCONSISTENT = "stale_or_inconsistent"
    MALFORMED_OBSERVATION = "malformed_observation"
    PROTOCOL_VIOLATION = "protocol_violation"


class VerifierObservationError(EffectFabricError):
    """Typed observation failure used to distinguish retryable uncertainty from mismatch."""

    def __init__(
        self,
        message: str,
        *,
        kind: VerifierErrorKind,
        retryable: bool,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.kind = kind
        self.retryable = retryable
        self.metadata = metadata or {}


class ReconciliationRequired(EffectFabricError):
    pass


class VerificationError(EffectFabricError):
    pass


class StaleFence(EffectFabricError):
    pass


class FencingEpochViolation(EffectFabricError):
    """A generic write attempted to mint or rewrite a fencing epoch."""


class ImmutableFieldViolation(EffectFabricError):
    pass


class RecoveryUnavailable(EffectFabricError):
    pass


class LeaseNotExpired(EffectFabricError):
    pass


class StaleAttemptOwner(EffectFabricError):
    """The worker trying to finalize an attempt does not own that attempt lease."""


class InvalidAttemptState(EffectFabricError):
    """An attempt lifecycle operation was requested from an incompatible state."""


class StaleOutboxClaim(EffectFabricError):
    """An evidence dispatcher tried to mutate an outbox claim it no longer owns."""
