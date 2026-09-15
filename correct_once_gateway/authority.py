from __future__ import annotations

from pathlib import Path
from typing import Any

from adapter.python.curated_mcp_adapter import (
    AdapterDenied,
    RegistrationPin,
    build_effect_factory,
    load_admitted_registry,
    parse_active_mcp_pin,
)
from effect_fabric.gateway import EffectGateway, EffectGatewayConfig
from effect_fabric.gateway_policy import (
    GatewayPolicy,
    GatewayPolicyRequest,
    PolicyDecision,
    PolicyGrant,
    StaticGatewayPolicy,
)
from effect_fabric.integrations.mcp_gateway import McpTransport


GATEWAY_EXECUTION_PAIRS = frozenset({("read", "fast"), ("critical", "effect")})


def _is_mcp_runtime_record(record: dict[str, Any]) -> bool:
    capability = record.get("capability")
    if not isinstance(capability, dict):
        return False
    implementation = capability.get("implementation")
    return isinstance(implementation, dict) and implementation.get("kind") == "mcp"


def _execution_pair(record: dict[str, Any]) -> tuple[str | None, str | None]:
    execution = record.get("execution")
    if not isinstance(execution, dict):
        return (None, None)
    execution_class = execution.get("executionClass")
    executor = execution.get("executor")
    return (
        execution_class if isinstance(execution_class, str) else None,
        executor if isinstance(executor, str) else None,
    )


def _is_gateway_routable_record(record: dict[str, Any]) -> bool:
    if record.get("state") != "active":
        return False
    if not _is_mcp_runtime_record(record):
        return False
    return _execution_pair(record) in GATEWAY_EXECUTION_PAIRS


def load_gateway_pins(snapshot_path: Path) -> list[RegistrationPin]:
    snapshot = load_admitted_registry(snapshot_path)
    pins: list[RegistrationPin] = []
    for record in snapshot["records"]:
        if not isinstance(record, dict) or not _is_gateway_routable_record(record):
            continue
        pins.append(parse_active_mcp_pin(record))
    return pins


class LiveAuthorityPolicy(GatewayPolicy):
    """Re-checks the authoritative runtime snapshot on every effect authorization."""

    def __init__(
        self,
        *,
        inner: GatewayPolicy,
        snapshot_path: Path,
        pins_by_mcp: dict[tuple[str, str], RegistrationPin],
        policy_version: str = "correct-once/live-authority/v0.16",
    ) -> None:
        self._inner = inner
        self._snapshot_path = snapshot_path
        self._pins_by_mcp = dict(pins_by_mcp)
        self.policy_version = policy_version

    async def authorize(self, request: GatewayPolicyRequest) -> PolicyGrant:
        expected = self._pins_by_mcp.get((request.server, request.tool))
        if expected is None:
            return PolicyGrant(
                decision=PolicyDecision.DENY,
                policy_version=self.policy_version,
                reason=f"missing pinned capability for {request.server}/{request.tool}",
            )

        try:
            live_pin = self._load_live_pin(expected.capability_id)
        except Exception as exc:
            return PolicyGrant(
                decision=PolicyDecision.DENY,
                policy_version=self.policy_version,
                reason=str(exc),
            )

        if live_pin != expected:
            return PolicyGrant(
                decision=PolicyDecision.DENY,
                policy_version=self.policy_version,
                reason="authoritative pin drift detected",
            )

        return await self._inner.authorize(request)

    def _load_live_pin(self, capability_id: str) -> RegistrationPin:
        snapshot = load_admitted_registry(self._snapshot_path)
        for record in snapshot["records"]:
            if not isinstance(record, dict):
                continue
            capability = record.get("capability")
            if (
                isinstance(capability, dict)
                and capability.get("id") == capability_id
            ):
                if not _is_gateway_routable_record(record):
                    raise AdapterDenied(
                        f"authoritative capability is no longer gateway-routable: {capability_id}"
                    )
                return parse_active_mcp_pin(record)
        raise AdapterDenied(
            f"authoritative snapshot no longer contains capability id: {capability_id}"
        )


def build_live_gateway(
    *,
    snapshot_path: Path,
    transport: McpTransport,
    policy_version: str,
    approval_secret: str | None = None,
    approval_required_operations: set[str] | frozenset[str] = frozenset(),
    worker_id: str = "correct-once-gateway",
    capability_ttl_seconds: int = 60,
    lease_seconds: int = 30,
    auto_reconcile_unknown: bool = True,
    auto_verify: bool = True,
) -> tuple[EffectGateway, dict[tuple[str, str], RegistrationPin]]:
    gateway = EffectGateway(
        transport=transport,
        config=EffectGatewayConfig(
            worker_id=worker_id,
            capability_ttl_seconds=capability_ttl_seconds,
            lease_seconds=lease_seconds,
            auto_reconcile_unknown=auto_reconcile_unknown,
            auto_verify=auto_verify,
            allow_unregistered_reads=False,
        ),
    )
    allowed_operations: set[str] = set()
    pins_by_mcp: dict[tuple[str, str], RegistrationPin] = {}

    for pin in load_gateway_pins(snapshot_path):
        key = (pin.server, pin.tool)
        existing = pins_by_mcp.get(key)
        if existing is not None and existing.capability_id != pin.capability_id:
            raise AdapterDenied(
                f"MCP {pin.server}/{pin.tool} already pinned to {existing.capability_id}"
            )
        gateway.register_tool(build_effect_factory(pin))
        allowed_operations.add(pin.operation)
        pins_by_mcp[key] = pin

    gateway.policy = LiveAuthorityPolicy(
        inner=StaticGatewayPolicy(
            allowed_operations=allowed_operations,
            approval_required_operations=set(approval_required_operations),
            approval_secret=approval_secret,
            policy_version=policy_version,
        ),
        snapshot_path=snapshot_path,
        pins_by_mcp=pins_by_mcp,
        policy_version=policy_version,
    )
    return gateway, pins_by_mcp
