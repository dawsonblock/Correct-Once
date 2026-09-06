"""Minimal SDK-neutral Effect Gateway example.

Replace DemoTransport with an adapter for your MCP client library.  The important boundary is that
agents call EffectGateway.call_tool() rather than the transport directly for registered tools.
"""
from __future__ import annotations

import asyncio
from typing import Any

from effect_fabric.effect_registry import McpToolIdentity, MutationClass
from effect_fabric.gateway import EffectDefinitionFactory, EffectGateway
from effect_fabric.gateway_policy import StaticGatewayPolicy
from effect_fabric.integrations.mcp_gateway import McpToolDescriptor, McpToolResult
from effect_fabric.models import EffectContract, IdempotencyContract, ReversibilityClass, ReversibilitySpec
from effect_fabric.provider_profiles import (
    IdempotencyMode,
    OutcomeResolutionMode,
    ProbeMissMeaning,
    ProviderEffectProfile,
)


SCHEMA = {
    "type": "object",
    "properties": {
        "entity_id": {"type": "string"},
        "state": {"type": "string"},
    },
    "required": ["entity_id", "state"],
}


class DemoTransport:
    async def describe_tool(self, server: str, tool: str) -> McpToolDescriptor:
        return McpToolDescriptor(server=server, name=tool, input_schema=SCHEMA)

    async def list_tools(self, server: str) -> list[McpToolDescriptor]:
        return [McpToolDescriptor(server=server, name="set_state", input_schema=SCHEMA)]

    async def call_tool(
        self,
        server: str,
        tool: str,
        arguments: dict[str, Any],
    ) -> McpToolResult:
        print(f"MCP CALL {server}/{tool}: {arguments}")
        return McpToolResult(content={"ok": True, **arguments}, external_id=arguments["entity_id"])


def profile() -> ProviderEffectProfile:
    return ProviderEffectProfile(
        profile_id="demo-mcp",
        tool_pattern="home.set_state",
        idempotency_mode=IdempotencyMode.NATURAL_BUSINESS_KEY,
        resolution_mode=OutcomeResolutionMode.NONE,
        miss_meaning=ProbeMissMeaning.INCONCLUSIVE,
    )


def definition() -> EffectDefinitionFactory:
    return EffectDefinitionFactory(
        operation="home.entity.set_state",
        mcp=McpToolIdentity(server="home", tool="set_state", input_schema=SCHEMA),
        mutation_class=MutationClass.MUTATING,
        executor="mcp:home:set_state",
        provider_profile=profile(),
        factory_version="1",
        resource_factory=lambda a: f"home://{a['entity_id']}",
        contract_factory=lambda a: EffectContract(
            resource=f"home://{a['entity_id']}",
            verifier="home-state-verifier",
        ),
        idempotency_factory=lambda a: IdempotencyContract(
            mechanism="natural_resource",
            key=f"home:{a['entity_id']}:state:{a['state']}",
            retry_after_not_happened=False,
        ),
        reversibility_factory=lambda a: ReversibilitySpec(
            classification=ReversibilityClass.UNKNOWN
        ),
    )


async def main() -> None:
    gateway = EffectGateway(
        transport=DemoTransport(),
        policy=StaticGatewayPolicy(allowed_operations={"home.entity.set_state"}),
    )
    gateway.register_tool(definition())
    result = await gateway.call_tool(
        subject="personal-assistant",
        server="home",
        tool="set_state",
        arguments={"entity_id": "light.office", "state": "on"},
        trace_id="demo-1",
    )
    print(result.model_dump(mode="json"))


if __name__ == "__main__":
    asyncio.run(main())
