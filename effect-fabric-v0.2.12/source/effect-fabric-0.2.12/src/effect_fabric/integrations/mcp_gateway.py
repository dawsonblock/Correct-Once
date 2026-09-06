"""SDK-neutral MCP transport and mutation adapter for Effect Gateway.

The host supplies an :class:`McpTransport` implementation for its MCP SDK.  Effect Fabric owns
routing, schema pinning, transaction lifecycle, capability issuance, uncertainty handling, and
reconciliation.  Unknown mutations fail closed.
"""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Protocol

from pydantic import BaseModel, ConfigDict, Field

from ..canonical import digest_document
from ..errors import ProviderErrorKind, ProviderExecutionError
from ..interfaces import EffectExecutor
from ..models import (
    ActionIntent,
    EffectContract,
    ExecutionAttempt,
    PreparedEffect,
    ProviderReceipt,
    ReconciliationStatus,
)


class McpToolDescriptor(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    server: str
    name: str
    input_schema: dict[str, Any] = Field(default_factory=dict)
    declared_read_only: bool = False
    description: str | None = None

    @property
    def schema_digest(self) -> str:
        return digest_document(self.input_schema)


class McpToolResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    content: Any = None
    external_id: str | None = None
    status_code: int | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    @property
    def response_digest(self) -> str:
        return digest_document(self.model_dump(mode="json"))


class McpTransport(Protocol):
    async def describe_tool(self, server: str, tool: str) -> McpToolDescriptor: ...

    async def list_tools(self, server: str) -> list[McpToolDescriptor]: ...

    async def call_tool(
        self,
        server: str,
        tool: str,
        arguments: dict[str, Any],
    ) -> McpToolResult: ...


PrepareProbe = Callable[[ActionIntent, EffectContract], Awaitable[PreparedEffect]]
ReconcileProbe = Callable[
    [ActionIntent, PreparedEffect, ExecutionAttempt], Awaitable[ReconciliationStatus]
]


@dataclass(frozen=True)
class McpMutationAdapterConfig:
    server: str
    tool: str
    executor_name: str
    expected_schema_digest: str
    prepare_probe: PrepareProbe | None = None
    reconcile_probe: ReconcileProbe | None = None


class McpMutationExecutor(EffectExecutor):
    """Generic MCP executor with a pre-effect schema revalidation boundary."""

    def __init__(self, transport: McpTransport, config: McpMutationAdapterConfig):
        self.transport = transport
        self.config = config
        self.name = config.executor_name
        self._volatile_results: dict[str, McpToolResult] = {}

    async def prepare(
        self,
        intent: ActionIntent,
        contract: EffectContract,
    ) -> PreparedEffect:
        if self.config.prepare_probe is not None:
            return await self.config.prepare_probe(intent, contract)
        if contract.preconditions:
            raise ProviderExecutionError(
                "MCP effect has preconditions but no prepare probe",
                kind=ProviderErrorKind.PROTOCOL_VIOLATION,
                may_have_happened=False,
                safe_to_retry=False,
                metadata={"server": self.config.server, "tool": self.config.tool},
            )
        descriptor = await self.transport.describe_tool(self.config.server, self.config.tool)
        if descriptor.schema_digest != self.config.expected_schema_digest:
            raise ProviderExecutionError(
                "MCP schema drift detected during prepare",
                kind=ProviderErrorKind.DEFINITIVE_REJECTION,
                may_have_happened=False,
                safe_to_retry=False,
                metadata={
                    "expected_schema_digest": self.config.expected_schema_digest,
                    "observed_schema_digest": descriptor.schema_digest,
                },
            )
        return PreparedEffect(
            observed_pre_state={"mcp_schema_digest": descriptor.schema_digest},
            external_version=descriptor.schema_digest,
        )

    async def execute(
        self,
        intent: ActionIntent,
        prepared: PreparedEffect,
        attempt: ExecutionAttempt,
    ) -> ProviderReceipt:
        # Re-read tool metadata immediately before crossing the external mutation boundary.  This
        # prevents knowingly executing a tool whose input contract changed after routing/prepare.
        descriptor = await self.transport.describe_tool(self.config.server, self.config.tool)
        if descriptor.schema_digest != self.config.expected_schema_digest:
            raise ProviderExecutionError(
                "MCP schema changed after prepare; refusing mutation",
                kind=ProviderErrorKind.DEFINITIVE_REJECTION,
                may_have_happened=False,
                safe_to_retry=False,
                metadata={
                    "expected_schema_digest": self.config.expected_schema_digest,
                    "prepared_schema_digest": prepared.external_version,
                    "observed_schema_digest": descriptor.schema_digest,
                },
            )

        result = await self.transport.call_tool(
            self.config.server,
            self.config.tool,
            dict(intent.arguments),
        )
        self._volatile_results[attempt.attempt_id] = result
        return ProviderReceipt(
            provider=f"mcp:{self.config.server}",
            operation=intent.operation,
            external_id=result.external_id,
            status_code=result.status_code,
            idempotency_key=None,
            response_digest=result.response_digest,
            metadata={
                "mcp_server": self.config.server,
                "mcp_tool": self.config.tool,
                "mcp_schema_digest": descriptor.schema_digest,
                **result.metadata,
            },
        )

    async def reconcile(
        self,
        intent: ActionIntent,
        prepared: PreparedEffect,
        attempt: ExecutionAttempt,
    ) -> ReconciliationStatus:
        if self.config.reconcile_probe is None:
            return ReconciliationStatus.UNKNOWN
        return await self.config.reconcile_probe(intent, prepared, attempt)

    def pop_result(self, attempt_id: str | None) -> McpToolResult | None:
        if attempt_id is None:
            return None
        return self._volatile_results.pop(attempt_id, None)
