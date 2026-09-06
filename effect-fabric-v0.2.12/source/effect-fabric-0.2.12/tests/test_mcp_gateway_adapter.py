from __future__ import annotations

from typing import Any

import pytest

from effect_fabric.errors import ProviderExecutionError
from effect_fabric.integrations.mcp_gateway import (
    McpMutationAdapterConfig,
    McpMutationExecutor,
    McpToolDescriptor,
    McpToolResult,
)
from effect_fabric.models import (
    ActionIntent,
    EffectContract,
    ExecutionAttempt,
    ReconciliationStatus,
)


class DriftingTransport:
    def __init__(self, schemas: list[dict[str, Any]]) -> None:
        self.schemas = list(schemas)
        self.calls = 0

    async def describe_tool(self, server: str, tool: str) -> McpToolDescriptor:
        schema = self.schemas.pop(0) if len(self.schemas) > 1 else self.schemas[0]
        return McpToolDescriptor(server=server, name=tool, input_schema=schema)

    async def list_tools(self, server: str):
        del server
        return []

    async def call_tool(self, server: str, tool: str, arguments: dict[str, Any]):
        del server, tool, arguments
        self.calls += 1
        return McpToolResult(content={"ok": True})


def intent() -> ActionIntent:
    return ActionIntent(
        subject="agent",
        operation="demo.set",
        resource="demo://1",
        arguments={"value": 1},
    )


@pytest.mark.asyncio
async def test_executor_revalidates_schema_immediately_before_mutation():
    schema1 = {"type": "object", "properties": {"value": {"type": "integer"}}}
    schema2 = {"type": "object", "properties": {"value": {"type": "string"}}}
    initial = McpToolDescriptor(server="demo", name="set", input_schema=schema1)
    transport = DriftingTransport([schema1, schema2])
    executor = McpMutationExecutor(
        transport,
        McpMutationAdapterConfig(
            server="demo",
            tool="set",
            executor_name="demo-set",
            expected_schema_digest=initial.schema_digest,
        ),
    )
    prepared = await executor.prepare(intent(), EffectContract(resource="demo://1", verifier="v"))
    with pytest.raises(ProviderExecutionError) as caught:
        await executor.execute(
            intent(),
            prepared,
            ExecutionAttempt(transaction_id="tx", executor="demo-set", fencing_epoch=1),
        )
    assert caught.value.may_have_happened is False
    assert transport.calls == 0


@pytest.mark.asyncio
async def test_executor_without_reconcile_probe_stays_unknown():
    schema = {"type": "object"}
    descriptor = McpToolDescriptor(server="demo", name="set", input_schema=schema)
    transport = DriftingTransport([schema])
    executor = McpMutationExecutor(
        transport,
        McpMutationAdapterConfig(
            server="demo",
            tool="set",
            executor_name="demo-set",
            expected_schema_digest=descriptor.schema_digest,
        ),
    )
    prepared = await executor.prepare(intent(), EffectContract(resource="demo://1", verifier="v"))
    status = await executor.reconcile(
        intent(),
        prepared,
        ExecutionAttempt(transaction_id="tx", executor="demo-set", fencing_epoch=1),
    )
    assert status is ReconciliationStatus.UNKNOWN
