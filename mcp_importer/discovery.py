from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from typing import Any, Protocol

from .normalize import NormalizedMcpTool, normalize_tool


class McpDiscoveryClient(Protocol):
    async def list_tools(self) -> Sequence[Mapping[str, Any]]: ...


async def discover_tools(
    server: str,
    client: McpDiscoveryClient,
    *,
    verified_read_only_tools: Iterable[str] = (),
) -> list[NormalizedMcpTool]:
    verified = frozenset(verified_read_only_tools)
    tools = await client.list_tools()
    return [
        normalize_tool(
            server,
            tool,
            verified_read_only=str(tool.get("name")) in verified,
        )
        for tool in tools
    ]
