from __future__ import annotations

import argparse
import hmac
import json
from dataclasses import replace
from pathlib import Path
from typing import Any

from fastapi import Header, HTTPException
import uvicorn

from adapter.python.curated_mcp_adapter import (
    AdapterDenied,
    RegistrationPin,
    build_effect_factory,
    load_admitted_registry,
    parse_active_mcp_pin,
)
from effect_fabric.errors import AmbiguousEffectError
from effect_fabric.gateway import EffectGateway
from effect_fabric.gateway_api import create_gateway_app
from effect_fabric.gateway_policy import (
    GatewayPolicy,
    GatewayPolicyRequest,
    PolicyDecision,
    PolicyGrant,
    StaticGatewayPolicy,
)
from effect_fabric.integrations.mcp_gateway import McpToolDescriptor, McpToolResult
from effect_fabric.models import ReconciliationStatus
from effect_fabric.provider_profiles import (
    IdempotencyMode,
    OutcomeResolutionMode,
    ProbeMissMeaning,
    ProviderEffectProfile,
)


def _tool_key(server: str, tool: str) -> str:
    return f"{server}/{tool}"


class ControlledFakeMcpTransport:
    def __init__(self, control_path: Path) -> None:
        self.control_path = control_path
        self.calls: list[dict[str, Any]] = []

    def _read_control(self) -> dict[str, Any]:
        return json.loads(self.control_path.read_text(encoding="utf-8"))

    def tool_config(self, server: str, tool: str) -> dict[str, Any]:
        tools = self._read_control().get("tools")
        if not isinstance(tools, dict):
            raise RuntimeError("control.tools must be an object")
        config = tools.get(_tool_key(server, tool))
        if not isinstance(config, dict):
            raise RuntimeError(f"missing control config for {server}/{tool}")
        return config

    async def describe_tool(self, server: str, tool: str) -> McpToolDescriptor:
        config = self.tool_config(server, tool)
        schema = config.get("schema") or {}
        if not isinstance(schema, dict):
            raise RuntimeError(f"{server}/{tool} schema must be an object")
        return McpToolDescriptor(
            server=server,
            name=tool,
            input_schema=schema,
            declared_read_only=bool(config.get("readOnly", False)),
        )

    async def list_tools(self, server: str) -> list[McpToolDescriptor]:
        tools = self._read_control().get("tools")
        if not isinstance(tools, dict):
            raise RuntimeError("control.tools must be an object")
        out: list[McpToolDescriptor] = []
        for key, config in tools.items():
            if not isinstance(key, str) or not isinstance(config, dict):
                continue
            candidate_server, _, candidate_tool = key.partition("/")
            if candidate_server != server or not candidate_tool:
                continue
            schema = config.get("schema") or {}
            if not isinstance(schema, dict):
                raise RuntimeError(f"{key} schema must be an object")
            out.append(
                McpToolDescriptor(
                    server=candidate_server,
                    name=candidate_tool,
                    input_schema=schema,
                    declared_read_only=bool(config.get("readOnly", False)),
                )
            )
        return out

    async def call_tool(
        self, server: str, tool: str, arguments: dict[str, Any]
    ) -> McpToolResult:
        config = self.tool_config(server, tool)
        self.calls.append(
            {
                "server": server,
                "tool": tool,
                "arguments": dict(arguments),
            }
        )
        mode = str(config.get("mode", "success"))
        if mode == "success":
            payload = config.get("result") or {"ok": True}
            if not isinstance(payload, dict):
                raise RuntimeError(f"{server}/{tool} result must be an object")
            return McpToolResult(
                content=dict(payload),
                external_id=str(
                    config.get("externalId", f"{tool}-{len(self.calls)}")
                ),
                status_code=int(config.get("statusCode", 200)),
            )
        if mode == "ambiguous_after_effect":
            raise AmbiguousEffectError(
                f"simulated ambiguous outcome for {server}/{tool}",
                metadata={
                    "server": server,
                    "tool": tool,
                },
            )
        raise RuntimeError(f"unsupported control mode for {server}/{tool}: {mode}")


class LiveSnapshotPolicy(GatewayPolicy):
    def __init__(
        self,
        *,
        inner: GatewayPolicy,
        snapshot_path: Path,
        pins_by_mcp: dict[tuple[str, str], RegistrationPin],
        policy_version: str = "qualification/live-snapshot/v1",
    ) -> None:
        self._inner = inner
        self._snapshot_path = snapshot_path
        self._pins_by_mcp = dict(pins_by_mcp)
        self.policy_version = policy_version

    def _load_pin(self, capability_id: str) -> RegistrationPin:
        snapshot = load_admitted_registry(self._snapshot_path)
        for record in snapshot["records"]:
            cap = record.get("capability")
            if isinstance(cap, dict) and cap.get("id") == capability_id:
                return parse_active_mcp_pin(record)
        raise AdapterDenied(
            f"authoritative snapshot no longer contains capability id: {capability_id}"
        )

    async def authorize(self, request: GatewayPolicyRequest) -> PolicyGrant:
        expected = self._pins_by_mcp.get((request.server, request.tool))
        if expected is None:
            return PolicyGrant(
                decision=PolicyDecision.DENY,
                policy_version=self.policy_version,
                reason=f"missing pinned capability for {request.server}/{request.tool}",
            )
        try:
            live = self._load_pin(expected.capability_id)
        except Exception as exc:
            return PolicyGrant(
                decision=PolicyDecision.DENY,
                policy_version=self.policy_version,
                reason=str(exc),
            )
        if live != expected:
            return PolicyGrant(
                decision=PolicyDecision.DENY,
                policy_version=self.policy_version,
                reason="authoritative pin drift detected",
            )
        return await self._inner.authorize(request)


def _uncertain_profile(tool_pattern: str) -> ProviderEffectProfile:
    return ProviderEffectProfile(
        profile_id=f"qualification:{tool_pattern}",
        tool_pattern=tool_pattern,
        idempotency_mode=IdempotencyMode.SENDER_CONTROLLED_KEY,
        resolution_mode=OutcomeResolutionMode.AUTHORITATIVE_PROBE,
        miss_meaning=ProbeMissMeaning.INCONCLUSIVE,
        authoritative_source="qualification-control-file",
    )


def _reconcile_probe(
    transport: ControlledFakeMcpTransport, server: str, tool: str
):
    async def probe(*_args: Any) -> ReconciliationStatus:
        status = str(
            transport.tool_config(server, tool).get("reconcileStatus", "unknown")
        )
        match status:
            case "happened":
                return ReconciliationStatus.HAPPENED
            case "not_happened":
                return ReconciliationStatus.NOT_HAPPENED
            case "unknown":
                return ReconciliationStatus.UNKNOWN
        raise RuntimeError(f"unsupported reconcileStatus for {server}/{tool}: {status}")

    return probe


def build_gateway(snapshot_path: Path, control_path: Path) -> tuple[EffectGateway, ControlledFakeMcpTransport]:
    transport = ControlledFakeMcpTransport(control_path)
    gateway = EffectGateway(transport=transport)
    snapshot = load_admitted_registry(snapshot_path)
    operations: set[str] = set()
    approval_required_operations: set[str] = set()
    approval_secret: str | None = None
    pins_by_mcp: dict[tuple[str, str], RegistrationPin] = {}
    for record in snapshot["records"]:
        if record.get("state") != "active":
            continue
        execution = record.get("execution")
        if isinstance(execution, dict):
            execution_pair = (
                execution.get("executionClass"),
                execution.get("executor"),
            )
            # The live gateway only registers read passthrough and critical effect pins.
            if execution_pair not in {("read", "fast"), ("critical", "effect")}:
                continue
        pin = parse_active_mcp_pin(record)
        factory = build_effect_factory(pin)
        reconcile_probe = None
        if pin.tool == "repo.uncertain":
            factory = replace(
                factory,
                provider_profile=_uncertain_profile(f"{pin.server}.{pin.tool}"),
            )
            reconcile_probe = _reconcile_probe(transport, pin.server, pin.tool)
        gateway.register_tool(factory, reconcile_probe=reconcile_probe)
        operations.add(pin.operation)
        tool_config = transport.tool_config(pin.server, pin.tool)
        tool_approval_secret = tool_config.get("approvalSecret")
        if tool_approval_secret is not None:
            if not isinstance(tool_approval_secret, str) or not tool_approval_secret:
                raise RuntimeError(
                    f"{pin.server}/{pin.tool} approvalSecret must be a non-empty string"
                )
            if approval_secret is None:
                approval_secret = tool_approval_secret
            elif approval_secret != tool_approval_secret:
                raise RuntimeError(
                    "qualification harness requires a single shared approval secret"
                )
            approval_required_operations.add(pin.operation)
        pins_by_mcp[(pin.server, pin.tool)] = pin

    gateway.policy = LiveSnapshotPolicy(
        inner=StaticGatewayPolicy(
            allowed_operations=operations,
            approval_required_operations=approval_required_operations,
            approval_secret=approval_secret,
        ),
        snapshot_path=snapshot_path,
        pins_by_mcp=pins_by_mcp,
    )
    return gateway, transport


def create_app(snapshot_path: Path, control_path: Path, token: str):
    gateway, transport = build_gateway(snapshot_path, control_path)
    app = create_gateway_app(gateway, api_token=token)

    async def require_token(authorization: str | None = Header(default=None)) -> None:
        prefix = "Bearer "
        if not authorization or not authorization.startswith(prefix):
            raise HTTPException(status_code=401, detail="authentication required")
        if not hmac.compare_digest(authorization[len(prefix) :], token):
            raise HTTPException(status_code=403, detail="forbidden")

    @app.get("/debug/calls")
    async def calls() -> dict[str, Any]:
        return {"count": len(transport.calls), "calls": list(transport.calls)}

    @app.post("/bridge/mcp-call")
    async def mcp_call(
        request: dict[str, Any],
        authorization: str | None = Header(default=None),
    ) -> dict[str, Any]:
        await require_token(authorization)
        server = request.get("server")
        tool = request.get("tool")
        arguments = request.get("arguments")
        if not isinstance(server, str) or not server:
            raise HTTPException(status_code=400, detail="server must be a non-empty string")
        if not isinstance(tool, str) or not tool:
            raise HTTPException(status_code=400, detail="tool must be a non-empty string")
        if arguments is None:
            arguments = {}
        if not isinstance(arguments, dict):
            raise HTTPException(status_code=400, detail="arguments must be an object")
        result = await transport.call_tool(server, tool, arguments)
        return dict(result.content)

    @app.get("/debug/transactions/{transaction_id}")
    async def transaction(transaction_id: str) -> dict[str, Any]:
        try:
            tx = await gateway.engine.store.get_transaction(transaction_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="transaction not found") from exc
        return tx.model_dump(mode="json")

    return app


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--control", required=True)
    parser.add_argument("--token", required=True)
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()

    app = create_app(Path(args.snapshot), Path(args.control), args.token)
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
