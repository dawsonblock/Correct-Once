from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from adapter.python.call_time_policy import SubjectAllowlist
from adapter.python.curated_mcp_adapter import AdapterError, CuratedMcpAdapter
from effect_fabric.gateway import EffectGateway
from effect_fabric.integrations.mcp_gateway import McpToolDescriptor, McpToolResult


WRITE_CAPABILITY_ID = "github.repo.settings"


class FakeMcpTransport:
    def __init__(self) -> None:
        self.schemas: dict[tuple[str, str], dict[str, Any]] = {}
        self.read_only: dict[tuple[str, str], bool] = {}
        self.results: dict[tuple[str, str], dict[str, Any]] = {}
        self.calls: list[tuple[str, str, dict[str, Any]]] = []

    def add(
        self,
        server: str,
        tool: str,
        schema: dict[str, Any],
        *,
        read_only: bool = False,
        result: dict[str, Any] | None = None,
    ) -> None:
        self.schemas[(server, tool)] = schema
        self.read_only[(server, tool)] = read_only
        self.results[(server, tool)] = {"ok": True} if result is None else result

    async def describe_tool(self, server: str, tool: str) -> McpToolDescriptor:
        return McpToolDescriptor(
            server=server,
            name=tool,
            input_schema=self.schemas[(server, tool)],
            declared_read_only=self.read_only[(server, tool)],
        )

    async def list_tools(self, server: str) -> list[McpToolDescriptor]:
        tools: list[McpToolDescriptor] = []
        for (candidate_server, candidate_tool), schema in self.schemas.items():
            if candidate_server != server:
                continue
            tools.append(
                McpToolDescriptor(
                    server=candidate_server,
                    name=candidate_tool,
                    input_schema=schema,
                    declared_read_only=self.read_only[(candidate_server, candidate_tool)],
                )
            )
        return tools

    async def call_tool(
        self, server: str, tool: str, arguments: dict[str, Any]
    ) -> McpToolResult:
        self.calls.append((server, tool, dict(arguments)))
        return McpToolResult(
            content=dict(self.results[(server, tool)]),
            external_id=f"external-{len(self.calls)}",
            status_code=200,
        )


def capability_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "repo": {"type": "string"},
            "mode": {"type": "string"},
        },
        "required": ["repo", "mode"],
    }


def write_capability_record() -> dict[str, Any]:
    schema_hash = f"schema:{WRITE_CAPABILITY_ID}"
    descriptor_hash = f"descriptor:{WRITE_CAPABILITY_ID}"
    candidate_hash = f"candidate:{WRITE_CAPABILITY_ID}"
    return {
        "state": "active",
        "stateVersion": 1,
        "updatedAt": "2026-09-06T00:01:00.000Z",
        "capability": {
            "id": WRITE_CAPABILITY_ID,
            "app": "github",
            "capability": "repo.settings",
            "description": "write-identity vectors fixture",
            "lifecycle": "admitted",
            "inputSchema": capability_schema(),
            "outputSchema": {"type": "object"},
            "sideEffect": "write",
            "sensitivity": "public",
            "risk": "medium",
            "schemaHash": schema_hash,
            "descriptorHash": descriptor_hash,
            "candidateHash": candidate_hash,
            "provenance": {
                "connectorId": "github-mcp",
                "connectorType": "mcp",
                "version": "1",
                "discoveredAt": "2026-09-06T00:00:00.000Z",
                "schemaDigest": schema_hash,
            },
            "implementation": {
                "kind": "mcp",
                "server": "github",
                "tool": "repo.settings",
            },
            "admission": {
                "kind": "function-hooks.capability-admission.v1",
                "admissionId": f"adm:{WRITE_CAPABILITY_ID}",
                "policyVersion": "policy-1",
                "candidateHash": candidate_hash,
                "descriptorHash": descriptor_hash,
            },
        },
        "execution": {
            "executionClass": "critical",
            "executor": "effect",
            "schemaClassDigest": "schema-class:critical",
            "requiresLightweightAuth": False,
            "trustedRead": False,
        },
    }


def write_adapter_snapshot(path: Path) -> None:
    path.write_text(
        json.dumps(
            {
                "format": "adapter/admitted-registry/v1",
                "source": {
                    "package": "@function-hooks/capabilities",
                    "version": "0.11.0",
                },
                "records": [write_capability_record()],
            }
        ),
        encoding="utf-8",
    )


def load_vectors() -> list[dict[str, Any]]:
    path = Path(__file__).resolve().parents[2] / "qualification" / "write-identity-vectors.json"
    document = json.loads(path.read_text(encoding="utf-8"))
    return list(document["cases"])


def subject_allowlist(*classes: str) -> SubjectAllowlist:
    return SubjectAllowlist(allowed_classes=frozenset(classes))


@pytest.mark.asyncio
async def test_shared_write_identity_vectors_are_applied_to_effect_gateway(
    tmp_path: Path,
) -> None:
    snapshot = tmp_path / "adapter-snapshot.json"
    write_adapter_snapshot(snapshot)

    transport = FakeMcpTransport()
    transport.add("github", "repo.settings", capability_schema())
    gateway = EffectGateway(transport=transport)
    adapter = CuratedMcpAdapter(
        gateway,
        subjects={"tenant-a": subject_allowlist("write")},
    )
    adapter.register_from_snapshot(snapshot)

    for vector in load_vectors():
        result = await adapter.invoke_capability(
            subject=vector["subject"],
            capability_id=vector["capabilityId"],
            arguments=vector["input"],
            caller_correlation_id=vector["callerCorrelationId"],
            idempotency_key=vector["idempotencyKey"],
            metadata=vector["metadata"],
            semantic_metadata=vector["semanticMetadata"],
        )
        tx = await gateway.engine.store.get_transaction(result.transaction_id)
        assert tx.action_digest == vector["expectedActionDigest"]
        assert tx.idempotency.key == vector["expectedTrustedIdempotencyKey"]
        assert tx.intent.intent_id == vector["expectedTrustedActionId"]
        assert tx.intent.trace_id == vector["expectedTraceId"]


@pytest.mark.asyncio
async def test_mutating_calls_require_nonempty_caller_idempotency_key(
    tmp_path: Path,
) -> None:
    snapshot = tmp_path / "adapter-snapshot.json"
    write_adapter_snapshot(snapshot)

    transport = FakeMcpTransport()
    transport.add("github", "repo.settings", capability_schema())
    gateway = EffectGateway(transport=transport)
    adapter = CuratedMcpAdapter(
        gateway,
        subjects={"tenant-a": subject_allowlist("write")},
    )
    adapter.register_from_snapshot(snapshot)

    with pytest.raises(AdapterError, match="idempotency"):
        await adapter.invoke_capability(
            subject="tenant-a",
            capability_id=WRITE_CAPABILITY_ID,
            arguments={"repo": "acme/example", "mode": "strict"},
        )
