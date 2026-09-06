#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
from typing import Any

from effect_fabric.effect_registry import McpToolIdentity, MutationClass
from effect_fabric.gateway import (
    EffectDefinitionFactory,
    EffectGateway,
    GatewayDenied,
    GatewayMode,
)
from effect_fabric.gateway_policy import StaticGatewayPolicy
from effect_fabric.integrations.mcp_gateway import McpToolDescriptor, McpToolResult
from effect_fabric.models import (
    EffectContract,
    IdempotencyContract,
    ReversibilityClass,
    ReversibilitySpec,
)
from effect_fabric.provider_profiles import (
    IdempotencyMode,
    OutcomeResolutionMode,
    ProbeMissMeaning,
    ProviderEffectProfile,
)
from effect_fabric.qualification.provenance import PACKAGE_VERSION


class Transport:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict[str, Any]]] = []
        self.schema = {"type": "object", "properties": {"id": {"type": "string"}}}

    async def describe_tool(self, server: str, tool: str) -> McpToolDescriptor:
        return McpToolDescriptor(
            server=server,
            name=tool,
            input_schema=self.schema,
            declared_read_only=tool == "get_item",
        )

    async def list_tools(self, server: str) -> list[McpToolDescriptor]:
        return [
            McpToolDescriptor(
                server=server,
                name="get_item",
                input_schema=self.schema,
                declared_read_only=True,
            ),
            McpToolDescriptor(
                server=server,
                name="set_item",
                input_schema=self.schema,
            ),
        ]

    async def call_tool(
        self,
        server: str,
        tool: str,
        arguments: dict[str, Any],
    ) -> McpToolResult:
        self.calls.append((server, tool, dict(arguments)))
        return McpToolResult(
            content={"tool": tool, "id": arguments.get("id")},
            external_id="q-1",
        )


def profile(pattern: str) -> ProviderEffectProfile:
    return ProviderEffectProfile(
        profile_id=f"qualification:{pattern}",
        tool_pattern=pattern,
        idempotency_mode=IdempotencyMode.NATURAL_BUSINESS_KEY,
        resolution_mode=OutcomeResolutionMode.NONE,
        miss_meaning=ProbeMissMeaning.INCONCLUSIVE,
        can_auto_rearm_on_miss=False,
    )


def read_definition(schema: dict[str, Any]) -> EffectDefinitionFactory:
    return EffectDefinitionFactory(
        operation="qualification.get",
        mcp=McpToolIdentity(
            server="qualification",
            tool="get_item",
            input_schema=schema,
        ),
        mutation_class=MutationClass.READ_ONLY,
        executor="unused",
        provider_profile=profile("qualification.get_item"),
        factory_version="1",
    )


def mutation_definition(schema: dict[str, Any]) -> EffectDefinitionFactory:
    return EffectDefinitionFactory(
        operation="qualification.set",
        mcp=McpToolIdentity(
            server="qualification",
            tool="set_item",
            input_schema=schema,
        ),
        mutation_class=MutationClass.MUTATING,
        executor="mcp:qualification:set_item",
        provider_profile=profile("qualification.set_item"),
        factory_version="1",
        resource_factory=lambda a: f"qualification://items/{a['id']}",
        contract_factory=lambda a: EffectContract(
            resource=f"qualification://items/{a['id']}",
            verifier="not-installed",
        ),
        idempotency_factory=lambda a: IdempotencyContract(
            mechanism="natural_resource",
            key=f"qualification:{a['id']}",
            retry_after_not_happened=False,
        ),
        reversibility_factory=lambda a: ReversibilitySpec(
            classification=ReversibilityClass.UNKNOWN
        ),
    )


async def run() -> dict[str, Any]:
    transport = Transport()
    gateway = EffectGateway(
        transport=transport,
        policy=StaticGatewayPolicy(allowed_operations={"qualification.set"}),
    )
    gateway.register_tool(read_definition(transport.schema))
    gateway.register_tool(mutation_definition(transport.schema))

    read = await gateway.call_tool(
        subject="qualification-agent",
        server="qualification",
        tool="get_item",
        arguments={"id": "a"},
    )
    mutation = await gateway.call_tool(
        subject="qualification-agent",
        server="qualification",
        tool="set_item",
        arguments={"id": "a"},
    )
    unknown_denied = False
    try:
        await gateway.call_tool(
            subject="qualification-agent",
            server="qualification",
            tool="unknown",
            arguments={"id": "a"},
        )
    except GatewayDenied:
        unknown_denied = True

    checks = {
        "registered_read_passthrough": (
            read.mode is GatewayMode.PASSTHROUGH_READ and read.transaction_id is None
        ),
        "mutation_governed": (
            mutation.mode is GatewayMode.GOVERNED_EFFECT
            and mutation.transaction_id is not None
        ),
        "mutation_receipt_recorded": mutation.execution_state == "receipt_recorded",
        "dynamic_effect_invoked_once": (
            transport.calls.count(("qualification", "set_item", {"id": "a"})) == 1
        ),
        "unknown_tool_denied": unknown_denied,
    }
    return {
        "schema": "effect-fabric/effect-gateway-qualification/v1",
        "version": PACKAGE_VERSION,
        "status": "PASS" if all(checks.values()) else "FAIL",
        "checks": checks,
        "claim": (
            "SDK-neutral Effect Gateway routes registered reads directly and registered "
            "mutations through EffectEngine under an independent policy boundary; unknown "
            "tools fail closed."
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("GATEWAY_QUALIFICATION.json"),
    )
    args = parser.parse_args()
    record = asyncio.run(run())
    args.output.write_text(
        json.dumps(record, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(record, indent=2, sort_keys=True))
    return 0 if record["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
