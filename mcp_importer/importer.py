from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from .admission import AdmissionDecision, admit_tool
from .discovery import McpDiscoveryClient, discover_tools
from .normalize import NormalizedMcpTool


@dataclass(frozen=True)
class ImportReport:
    admitted: tuple[AdmissionDecision, ...]
    denied: tuple[AdmissionDecision, ...]


def import_tools(tools: Iterable[NormalizedMcpTool]) -> ImportReport:
    admitted: list[AdmissionDecision] = []
    denied: list[AdmissionDecision] = []
    for tool in tools:
        decision = admit_tool(tool)
        if decision.admitted:
            admitted.append(decision)
        else:
            denied.append(decision)
    return ImportReport(admitted=tuple(admitted), denied=tuple(denied))


async def import_discovered_tools(
    server: str,
    client: McpDiscoveryClient,
    *,
    verified_read_only_tools: Iterable[str] = (),
) -> ImportReport:
    return import_tools(
        await discover_tools(
            server,
            client,
            verified_read_only_tools=verified_read_only_tools,
        )
    )
