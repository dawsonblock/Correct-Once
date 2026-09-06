from __future__ import annotations

from typing import Any

import pytest

from effect_fabric.effect_registry import McpToolIdentity, MutationClass
from effect_fabric.errors import DuplicateIdempotencyConflict
from effect_fabric.gateway import (
    EffectDefinitionFactory,
    EffectGateway,
    EffectGatewayConfig,
    GatewayApprovalRequired,
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


class FakeMcpTransport:
    def __init__(self) -> None:
        self.schemas: dict[tuple[str, str], dict[str, Any]] = {}
        self.read_only: dict[tuple[str, str], bool] = {}
        self.calls: list[tuple[str, str, dict[str, Any]]] = []
        self.results: dict[tuple[str, str], McpToolResult] = {}

    def add(
        self,
        server: str,
        tool: str,
        schema: dict[str, Any],
        *,
        read_only: bool = False,
        result: McpToolResult | None = None,
    ) -> None:
        self.schemas[(server, tool)] = schema
        self.read_only[(server, tool)] = read_only
        self.results[(server, tool)] = result or McpToolResult(content={"ok": True})

    async def describe_tool(self, server: str, tool: str) -> McpToolDescriptor:
        return McpToolDescriptor(
            server=server,
            name=tool,
            input_schema=self.schemas[(server, tool)],
            declared_read_only=self.read_only[(server, tool)],
        )

    async def list_tools(self, server: str) -> list[McpToolDescriptor]:
        result = []
        for (candidate_server, tool), schema in self.schemas.items():
            if candidate_server == server:
                result.append(
                    McpToolDescriptor(
                        server=server,
                        name=tool,
                        input_schema=schema,
                        declared_read_only=self.read_only[(server, tool)],
                    )
                )
        return result

    async def call_tool(
        self,
        server: str,
        tool: str,
        arguments: dict[str, Any],
    ) -> McpToolResult:
        self.calls.append((server, tool, dict(arguments)))
        return self.results[(server, tool)]


def unresolved_profile(tool_pattern: str) -> ProviderEffectProfile:
    return ProviderEffectProfile(
        profile_id=f"test:{tool_pattern}",
        tool_pattern=tool_pattern,
        idempotency_mode=IdempotencyMode.NATURAL_BUSINESS_KEY,
        resolution_mode=OutcomeResolutionMode.NONE,
        miss_meaning=ProbeMissMeaning.INCONCLUSIVE,
        can_auto_rearm_on_miss=False,
    )


def mutation_factory(schema: dict[str, Any]) -> EffectDefinitionFactory:
    return EffectDefinitionFactory(
        operation="demo.item.set",
        mcp=McpToolIdentity(server="demo", tool="set_item", input_schema=schema),
        mutation_class=MutationClass.MUTATING,
        executor="mcp:demo:set_item",
        provider_profile=unresolved_profile("demo.set_item"),
        factory_version="1",
        resource_factory=lambda a: f"demo://items/{a['id']}",
        contract_factory=lambda a: EffectContract(
            resource=f"demo://items/{a['id']}",
            verifier="demo-verifier",
        ),
        idempotency_factory=lambda a: IdempotencyContract(
            mechanism="natural_resource",
            key=f"demo:item:{a['id']}:value:{a['value']}",
            retry_after_not_happened=False,
        ),
        reversibility_factory=lambda a: ReversibilitySpec(
            classification=ReversibilityClass.UNKNOWN
        ),
    )


def read_factory(schema: dict[str, Any]) -> EffectDefinitionFactory:
    return EffectDefinitionFactory(
        operation="demo.item.get",
        mcp=McpToolIdentity(server="demo", tool="get_item", input_schema=schema),
        mutation_class=MutationClass.READ_ONLY,
        executor="unused-read-executor",
        provider_profile=unresolved_profile("demo.get_item"),
        factory_version="1",
    )


@pytest.mark.asyncio
async def test_registered_read_passthrough_does_not_create_transaction():
    schema = {"type": "object", "properties": {"id": {"type": "string"}}}
    transport = FakeMcpTransport()
    transport.add(
        "demo",
        "get_item",
        schema,
        read_only=True,
        result=McpToolResult(content={"v": 7}),
    )
    gateway = EffectGateway(transport=transport)
    gateway.register_tool(read_factory(schema))

    result = await gateway.call_tool(
        subject="agent-a",
        server="demo",
        tool="get_item",
        arguments={"id": "x"},
    )

    assert result.mode is GatewayMode.PASSTHROUGH_READ
    assert result.output == {"v": 7}
    assert result.transaction_id is None
    assert transport.calls == [("demo", "get_item", {"id": "x"})]


@pytest.mark.asyncio
async def test_unregistered_read_is_denied_by_default_even_with_readonly_hint():
    transport = FakeMcpTransport()
    transport.add("demo", "get_item", {}, read_only=True)
    gateway = EffectGateway(transport=transport)

    with pytest.raises(GatewayDenied):
        await gateway.call_tool(
            subject="agent-a", server="demo", tool="get_item", arguments={}
        )
    assert transport.calls == []


@pytest.mark.asyncio
async def test_explicit_unregistered_read_compatibility_mode_is_opt_in():
    transport = FakeMcpTransport()
    transport.add("demo", "get_item", {}, read_only=True)
    gateway = EffectGateway(
        transport=transport,
        config=EffectGatewayConfig(allow_unregistered_reads=True),
    )

    result = await gateway.call_tool(
        subject="agent-a", server="demo", tool="get_item", arguments={}
    )
    assert result.mode is GatewayMode.PASSTHROUGH_READ
    assert len(transport.calls) == 1


@pytest.mark.asyncio
async def test_registered_mutation_runs_through_effect_engine_and_dynamic_binding():
    schema = {
        "type": "object",
        "properties": {
            "id": {"type": "string"},
            "value": {"type": "integer"},
        },
        "required": ["id", "value"],
    }
    transport = FakeMcpTransport()
    transport.add(
        "demo",
        "set_item",
        schema,
        result=McpToolResult(content={"changed": True}, external_id="remote-1", status_code=200),
    )
    policy = StaticGatewayPolicy(allowed_operations={"demo.item.set"})
    gateway = EffectGateway(transport=transport, policy=policy)
    factory = mutation_factory(schema)
    gateway.register_tool(factory)

    first_bound = factory.bind({"id": "a", "value": 1})
    second_bound = factory.bind({"id": "b", "value": 1})
    assert first_bound.resource != second_bound.resource
    assert first_bound.idempotency.key != second_bound.idempotency.key

    result = await gateway.call_tool(
        subject="agent-a",
        server="demo",
        tool="set_item",
        arguments={"id": "a", "value": 1},
        trace_id="trace-1",
    )

    assert result.mode is GatewayMode.GOVERNED_EFFECT
    assert result.transaction_id is not None
    assert result.execution_state == "receipt_recorded"
    assert result.output == {"changed": True}
    assert transport.calls == [("demo", "set_item", {"id": "a", "value": 1})]
    tx = await gateway.engine.store.get_transaction(result.transaction_id)
    assert tx.intent.resource == "demo://items/a"
    assert tx.idempotency.key == "demo:item:a:value:1"
    assert tx.authorization_policy_version == "gateway/static/v1"


@pytest.mark.asyncio
async def test_trusted_identity_overrides_bound_idempotency_and_replays_without_a_second_effect():
    schema = {
        "type": "object",
        "properties": {
            "id": {"type": "string"},
            "value": {"type": "integer"},
        },
        "required": ["id", "value"],
    }
    transport = FakeMcpTransport()
    transport.add(
        "demo",
        "set_item",
        schema,
        result=McpToolResult(content={"changed": True}, external_id="remote-1", status_code=200),
    )
    gateway = EffectGateway(
        transport=transport,
        policy=StaticGatewayPolicy(allowed_operations={"demo.item.set"}),
    )
    gateway.register_tool(mutation_factory(schema))

    first = await gateway.call_tool(
        subject="agent-a",
        server="demo",
        tool="set_item",
        arguments={"id": "a", "value": 1},
        idempotency_key="trusted-namespace",
        action_id="trusted-action",
    )
    tx = await gateway.engine.store.get_transaction(first.transaction_id)
    assert tx.idempotency.key == "trusted-namespace"
    assert tx.intent.intent_id == "trusted-action"
    assert tx.intent.trace_id == "trusted-action"

    replay = await gateway.call_tool(
        subject="agent-a",
        server="demo",
        tool="set_item",
        arguments={"id": "a", "value": 1},
        idempotency_key="trusted-namespace",
        action_id="trusted-action",
    )
    assert replay.transaction_id == first.transaction_id
    assert transport.calls == [("demo", "set_item", {"id": "a", "value": 1})]


@pytest.mark.asyncio
async def test_semantic_metadata_changes_conflict_under_shared_trusted_idempotency():
    schema = {
        "type": "object",
        "properties": {
            "id": {"type": "string"},
            "value": {"type": "integer"},
        },
        "required": ["id", "value"],
    }
    transport = FakeMcpTransport()
    transport.add(
        "demo",
        "set_item",
        schema,
        result=McpToolResult(content={"changed": True}, external_id="remote-1", status_code=200),
    )
    gateway = EffectGateway(
        transport=transport,
        policy=StaticGatewayPolicy(allowed_operations={"demo.item.set"}),
    )
    gateway.register_tool(mutation_factory(schema))

    await gateway.call_tool(
        subject="agent-a",
        server="demo",
        tool="set_item",
        arguments={"id": "a", "value": 1},
        semantic_metadata={"consistency": "strong"},
        idempotency_key="trusted-namespace",
        action_id="trusted-action-strong",
    )

    with pytest.raises(DuplicateIdempotencyConflict):
        await gateway.call_tool(
            subject="agent-a",
            server="demo",
            tool="set_item",
            arguments={"id": "a", "value": 1},
            semantic_metadata={"consistency": "eventual"},
            idempotency_key="trusted-namespace",
            action_id="trusted-action-eventual",
        )
    assert transport.calls == [("demo", "set_item", {"id": "a", "value": 1})]


@pytest.mark.asyncio
async def test_policy_denial_happens_before_external_mutation():
    schema = {"type": "object"}
    transport = FakeMcpTransport()
    transport.add("demo", "set_item", schema)
    gateway = EffectGateway(
        transport=transport,
        policy=StaticGatewayPolicy(allowed_operations=set()),
    )
    gateway.register_tool(mutation_factory(schema))

    with pytest.raises(GatewayDenied):
        await gateway.call_tool(
            subject="agent-a",
            server="demo",
            tool="set_item",
            arguments={"id": "a", "value": 1},
        )
    assert transport.calls == []


@pytest.mark.asyncio
async def test_approval_required_operation_requires_valid_external_secret():
    schema = {"type": "object"}
    transport = FakeMcpTransport()
    transport.add("demo", "set_item", schema)
    policy = StaticGatewayPolicy(
        allowed_operations={"demo.item.set"},
        approval_required_operations={"demo.item.set"},
        approval_secret="human-approved",
    )
    gateway = EffectGateway(transport=transport, policy=policy)
    gateway.register_tool(mutation_factory(schema))

    with pytest.raises(GatewayApprovalRequired):
        await gateway.call_tool(
            subject="agent-a",
            server="demo",
            tool="set_item",
            arguments={"id": "a", "value": 1},
            approval_token="wrong",
        )
    assert transport.calls == []

    result = await gateway.call_tool(
        subject="agent-a",
        server="demo",
        tool="set_item",
        arguments={"id": "a", "value": 2},
        approval_token="human-approved",
    )
    tx = await gateway.engine.store.get_transaction(result.transaction_id)
    assert tx.approval_digest is not None


@pytest.mark.asyncio
async def test_schema_drift_is_denied_before_prepare_or_external_mutation():
    pinned = {"type": "object", "properties": {"value": {"type": "integer"}}}
    changed = {"type": "object", "properties": {"value": {"type": "string"}}}
    transport = FakeMcpTransport()
    transport.add("demo", "set_item", changed)
    gateway = EffectGateway(
        transport=transport,
        policy=StaticGatewayPolicy(allowed_operations={"demo.item.set"}),
    )
    gateway.register_tool(mutation_factory(pinned))

    with pytest.raises(GatewayDenied, match="schema drift"):
        await gateway.call_tool(
            subject="agent-a",
            server="demo",
            tool="set_item",
            arguments={"id": "a", "value": 1},
        )
    assert transport.calls == []


@pytest.mark.asyncio
async def test_list_tools_hides_unknown_and_drifted_tools():
    schema = {"type": "object"}
    transport = FakeMcpTransport()
    transport.add("demo", "get_item", schema, read_only=True)
    transport.add("demo", "unknown_read", schema, read_only=True)
    transport.add("demo", "set_item", schema)
    gateway = EffectGateway(transport=transport)
    gateway.register_tool(read_factory(schema))
    gateway.register_tool(mutation_factory(schema))

    visible = await gateway.list_tools("demo")
    assert {item.name for item in visible} == {"get_item", "set_item"}
