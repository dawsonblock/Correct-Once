from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from adapter.python.call_time_policy import SubjectAllowlist
from adapter.python.curated_mcp_adapter import AdapterDenied, CuratedMcpAdapter
from effect_fabric.errors import DuplicateIdempotencyConflict
from effect_fabric.gateway import EffectGateway
from effect_fabric.integrations.mcp_gateway import McpToolDescriptor, McpToolResult


WRITE_CAPABILITY_ID = "github.repo.settings"
READ_CAPABILITY_ID = "github.repo.read"


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
        if result is None:
            result = {"ok": True}
        self.results[(server, tool)] = result

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
            if not isinstance(candidate_tool, str):
                continue
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

    async def call_tool(self, server: str, tool: str, arguments: dict[str, Any]) -> McpToolResult:
        self.calls.append((server, tool, dict(arguments)))
        result = self.results[(server, tool)]
        return McpToolResult(
            content=dict(result),
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
        "required": ["repo"],
    }


def execution_block(
    *,
    execution_class: str,
    executor: str,
    schema_class_digest: str,
    requires_lightweight_auth: bool,
    trusted_read: bool,
) -> dict[str, Any]:
    return {
        "executionClass": execution_class,
        "executor": executor,
        "schemaClassDigest": schema_class_digest,
        "requiresLightweightAuth": requires_lightweight_auth,
        "trustedRead": trusted_read,
    }


def capability_record(
    *,
    capability_id: str,
    capability: str,
    tool: str,
    side_effect: str,
    state: str,
    execution: dict[str, Any],
) -> dict[str, Any]:
    schema_hash = f"schema:{capability_id}"
    descriptor_hash = f"descriptor:{capability_id}"
    candidate_hash = f"candidate:{capability_id}"
    return {
        "state": state,
        "stateVersion": 1,
        "updatedAt": "2026-09-06T00:01:00.000Z",
        "capability": {
            "id": capability_id,
            "app": "github",
            "capability": capability,
            "description": f"{capability_id} fixture",
            "lifecycle": "admitted",
            "inputSchema": capability_schema(),
            "outputSchema": {"type": "object"},
            "sideEffect": side_effect,
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
                "tool": tool,
            },
            "admission": {
                "kind": "function-hooks.capability-admission.v1",
                "admissionId": f"adm:{capability_id}",
                "policyVersion": "policy-1",
                "candidateHash": candidate_hash,
                "descriptorHash": descriptor_hash,
            },
        },
        "execution": execution,
    }


def write_adapter_snapshot(path: Path, records: list[dict[str, Any]]) -> None:
    path.write_text(
        json.dumps(
            {
                "format": "adapter/admitted-registry/v1",
                "source": {
                    "package": "@function-hooks/capabilities",
                    "version": "0.11.0",
                },
                "records": records,
            }
        ),
        encoding="utf-8",
    )


def write_capability_record(state: str = "active") -> dict[str, Any]:
    return capability_record(
        capability_id=WRITE_CAPABILITY_ID,
        capability="repo.settings",
        tool="repo.settings",
        side_effect="write",
        state=state,
        execution=execution_block(
            execution_class="critical",
            executor="effect",
            schema_class_digest="schema-class:critical",
            requires_lightweight_auth=False,
            trusted_read=False,
        ),
    )


def read_capability_record(state: str = "active") -> dict[str, Any]:
    return capability_record(
        capability_id=READ_CAPABILITY_ID,
        capability="repo.read",
        tool="repo.read",
        side_effect="read",
        state=state,
        execution=execution_block(
            execution_class="read",
            executor="fast",
            schema_class_digest="schema-class:read",
            requires_lightweight_auth=False,
            trusted_read=True,
        ),
    )


def subject_allowlist(*classes: str) -> SubjectAllowlist:
    return SubjectAllowlist(allowed_classes=frozenset(classes))


@pytest.mark.asyncio
async def test_distinct_mutations_of_same_capability_succeed_live(tmp_path: Path) -> None:
    snapshot = tmp_path / "adapter-snapshot.json"
    write_adapter_snapshot(snapshot, [write_capability_record()])

    transport = FakeMcpTransport()
    transport.add("github", "repo.settings", capability_schema())
    gateway = EffectGateway(transport=transport)
    adapter = CuratedMcpAdapter(
        gateway,
        subjects={"tenant-a": subject_allowlist("write")},
    )
    adapter.register_from_snapshot(snapshot)

    first = await adapter.invoke_capability(
        subject="tenant-a",
        capability_id=WRITE_CAPABILITY_ID,
        idempotency_key="distinct-strict",
        arguments={"repo": "acme/example", "mode": "strict"},
    )
    second = await adapter.invoke_capability(
        subject="tenant-a",
        capability_id=WRITE_CAPABILITY_ID,
        idempotency_key="distinct-relaxed",
        arguments={"repo": "acme/example", "mode": "relaxed"},
    )

    assert first.transaction_id != second.transaction_id
    assert transport.calls == [
        ("github", "repo.settings", {"repo": "acme/example", "mode": "strict"}),
        ("github", "repo.settings", {"repo": "acme/example", "mode": "relaxed"}),
    ]


@pytest.mark.asyncio
async def test_same_key_conflicts_on_payload_drift_and_subjects_are_isolated(
    tmp_path: Path,
) -> None:
    snapshot = tmp_path / "adapter-snapshot.json"
    write_adapter_snapshot(snapshot, [write_capability_record()])

    transport = FakeMcpTransport()
    transport.add("github", "repo.settings", capability_schema())
    gateway = EffectGateway(transport=transport)
    adapter = CuratedMcpAdapter(
        gateway,
        subjects={
            "tenant-a": subject_allowlist("write"),
            "tenant-b": subject_allowlist("write"),
        },
    )
    adapter.register_from_snapshot(snapshot)

    first = await adapter.invoke_capability(
        subject="tenant-a",
        capability_id=WRITE_CAPABILITY_ID,
        idempotency_key="shared-key",
        arguments={"repo": "acme/example", "mode": "strict"},
    )
    replay = await adapter.invoke_capability(
        subject="tenant-a",
        capability_id=WRITE_CAPABILITY_ID,
        idempotency_key="shared-key",
        arguments={"repo": "acme/example", "mode": "strict"},
    )
    assert replay.transaction_id == first.transaction_id
    assert len(transport.calls) == 1

    with pytest.raises(DuplicateIdempotencyConflict):
        await adapter.invoke_capability(
            subject="tenant-a",
            capability_id=WRITE_CAPABILITY_ID,
            idempotency_key="shared-key",
            arguments={"repo": "acme/example", "mode": "relaxed"},
        )

    subject_a = await adapter.invoke_capability(
        subject="tenant-a",
        capability_id=WRITE_CAPABILITY_ID,
        idempotency_key="same-key",
        arguments={"repo": "acme/example", "mode": "subject-a"},
    )
    subject_b = await adapter.invoke_capability(
        subject="tenant-b",
        capability_id=WRITE_CAPABILITY_ID,
        idempotency_key="same-key",
        arguments={"repo": "acme/example", "mode": "subject-b"},
    )
    assert subject_a.transaction_id != subject_b.transaction_id


@pytest.mark.asyncio
async def test_revocation_after_register_denies_without_rebuilding_adapter(
    tmp_path: Path,
) -> None:
    snapshot = tmp_path / "adapter-snapshot.json"
    write_adapter_snapshot(snapshot, [read_capability_record()])

    transport = FakeMcpTransport()
    transport.add(
        "github",
        "repo.read",
        capability_schema(),
        read_only=True,
        result={"repo": "acme/example"},
    )
    gateway = EffectGateway(transport=transport)
    adapter = CuratedMcpAdapter(
        gateway,
        subjects={"tenant-a": subject_allowlist("read")},
    )
    adapter.register_from_snapshot(snapshot)

    first = await adapter.invoke_capability(
        subject="tenant-a",
        capability_id=READ_CAPABILITY_ID,
        arguments={"repo": "acme/example"},
    )
    assert first.output == {"repo": "acme/example"}

    write_adapter_snapshot(snapshot, [read_capability_record(state="revoked")])

    with pytest.raises(AdapterDenied, match="active|revoked"):
        await adapter.invoke_capability(
            subject="tenant-a",
            capability_id=READ_CAPABILITY_ID,
            arguments={"repo": "acme/example"},
        )
    assert transport.calls == [("github", "repo.read", {"repo": "acme/example"})]
