"""Policy boundary for the Effect Gateway.

The gateway deliberately does not authorize mutations by itself.  A policy implementation must
return an explicit grant before :class:`EffectGateway` can mint an execution capability.
"""
from __future__ import annotations

import hmac
from dataclasses import dataclass
from enum import StrEnum

from .canonical import digest_document
from .models import EffectTransaction


class PolicyDecision(StrEnum):
    ALLOW = "allow"
    DENY = "deny"
    REQUIRE_APPROVAL = "require_approval"


@dataclass(frozen=True)
class GatewayPolicyRequest:
    transaction: EffectTransaction
    server: str
    tool: str
    registration_digest: str
    approval_token: str | None = None


@dataclass(frozen=True)
class PolicyGrant:
    decision: PolicyDecision
    policy_version: str
    approval_digest: str | None = None
    reason: str | None = None


class GatewayPolicy:
    """Abstract policy interface.

    Implementations may consult an external policy engine, a human approval service, workload
    identity, or a static local allow-list.  The returned approval digest is persisted; raw
    approval tokens are not.
    """

    async def authorize(self, request: GatewayPolicyRequest) -> PolicyGrant:  # pragma: no cover
        raise NotImplementedError


class DenyAllMutationPolicy(GatewayPolicy):
    """Secure default: no mutation can be authorized."""

    def __init__(self, *, policy_version: str = "gateway/deny-all/v1") -> None:
        self.policy_version = policy_version

    async def authorize(self, request: GatewayPolicyRequest) -> PolicyGrant:
        del request
        return PolicyGrant(
            decision=PolicyDecision.DENY,
            policy_version=self.policy_version,
            reason="no mutation policy was configured",
        )


class StaticGatewayPolicy(GatewayPolicy):
    """Small explicit policy suitable for local deployments and tests.

    ``allowed_operations`` is fail-closed.  Operations in ``approval_required_operations`` also
    require a secret approval token.  This class is intentionally simple; production deployments
    should normally replace it with an external approval/policy authority.
    """

    def __init__(
        self,
        *,
        allowed_operations: set[str] | frozenset[str],
        approval_required_operations: set[str] | frozenset[str] = frozenset(),
        approval_secret: str | None = None,
        policy_version: str = "gateway/static/v1",
    ) -> None:
        self.allowed_operations = frozenset(allowed_operations)
        self.approval_required_operations = frozenset(approval_required_operations)
        self._approval_secret = approval_secret
        self.policy_version = policy_version

    async def authorize(self, request: GatewayPolicyRequest) -> PolicyGrant:
        operation = request.transaction.intent.operation
        if operation not in self.allowed_operations:
            return PolicyGrant(
                decision=PolicyDecision.DENY,
                policy_version=self.policy_version,
                reason=f"operation not allow-listed: {operation}",
            )

        if operation in self.approval_required_operations:
            if self._approval_secret is None:
                return PolicyGrant(
                    decision=PolicyDecision.REQUIRE_APPROVAL,
                    policy_version=self.policy_version,
                    reason="approval-required operation has no configured approval verifier",
                )
            token = request.approval_token or ""
            if not hmac.compare_digest(token, self._approval_secret):
                return PolicyGrant(
                    decision=PolicyDecision.REQUIRE_APPROVAL,
                    policy_version=self.policy_version,
                    reason="valid external approval required",
                )
            approval_digest = digest_document(
                {
                    "transaction_id": request.transaction.transaction_id,
                    "action_digest": request.transaction.action_digest,
                    "registration_digest": request.registration_digest,
                    "approval_token_digest": digest_document({"token": token}),
                }
            )
        else:
            approval_digest = None

        return PolicyGrant(
            decision=PolicyDecision.ALLOW,
            policy_version=self.policy_version,
            approval_digest=approval_digest,
        )
