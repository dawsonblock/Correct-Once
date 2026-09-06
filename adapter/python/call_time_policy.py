"""Call-time allowlist re-check for curated catalog invokes.

Plugs into A GatewayPolicy.authorize (effect_fabric.gateway_policy).
Looks up RegistrationPin by request.server + request.tool (no _adapter_* args).
Destructive requires explicit allow_destructive (default OFF).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from effect_fabric.gateway_policy import (
    GatewayPolicy,
    GatewayPolicyRequest,
    PolicyDecision,
    PolicyGrant,
)

from .side_effect_map import map_side_effect

if TYPE_CHECKING:
    from .curated_mcp_adapter import RegistrationPin


@dataclass(frozen=True)
class SubjectAllowlist:
    """Per-subject allowlisted catalog classes + optional operation scope."""

    allowed_classes: frozenset[str] = field(
        default_factory=lambda: frozenset({"read"})
    )
    allowed_capability_ids: frozenset[str] | None = None
    allow_destructive: bool = False  # FAIL-CLOSED default


class CallTimeAllowlistPolicy(GatewayPolicy):
    """Wrap an inner A policy; re-check class + destructive flag at CALL TIME.

    Pin lookup is by GatewayPolicyRequest.server + .tool (A call_tool path).
    """

    def __init__(
        self,
        *,
        inner: GatewayPolicy,
        subjects: dict[str, SubjectAllowlist],
        pins_by_mcp: dict[tuple[str, str], RegistrationPin],
        policy_version: str = "adapter/call-time-allowlist/v1",
    ) -> None:
        self._inner = inner
        self._subjects = subjects
        self._pins_by_mcp = pins_by_mcp
        self.policy_version = policy_version

    async def authorize(self, request: GatewayPolicyRequest) -> PolicyGrant:
        subject = request.transaction.intent.subject
        allow = self._subjects.get(subject)
        if allow is None:
            return PolicyGrant(
                decision=PolicyDecision.DENY,
                policy_version=self.policy_version,
                reason=f"unknown subject denied: {subject}",
            )

        pin = self._pins_by_mcp.get((request.server, request.tool))
        if pin is None:
            return PolicyGrant(
                decision=PolicyDecision.DENY,
                policy_version=self.policy_version,
                reason=f"no admission pin for {request.server}/{request.tool}",
            )

        try:
            mapped = map_side_effect(pin.side_effect)
        except ValueError as exc:
            return PolicyGrant(
                decision=PolicyDecision.DENY,
                policy_version=self.policy_version,
                reason=str(exc),
            )

        if mapped.catalog_tag not in allow.allowed_classes:
            return PolicyGrant(
                decision=PolicyDecision.DENY,
                policy_version=self.policy_version,
                reason=f"class {mapped.catalog_tag!r} not allow-listed for {subject}",
            )

        if mapped.catalog_tag == "destructive" and not allow.allow_destructive:
            return PolicyGrant(
                decision=PolicyDecision.DENY,
                policy_version=self.policy_version,
                reason="destructive requires allow_destructive=True (default OFF)",
            )

        if (
            allow.allowed_capability_ids is not None
            and pin.capability_id not in allow.allowed_capability_ids
        ):
            return PolicyGrant(
                decision=PolicyDecision.DENY,
                policy_version=self.policy_version,
                reason=f"capability id not in subject scope: {pin.capability_id}",
            )

        return await self._inner.authorize(request)
