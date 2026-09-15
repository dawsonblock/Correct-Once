from __future__ import annotations

import asyncio
import contextlib
import json
import os
from collections import deque
from pathlib import Path
from typing import Any

from effect_fabric.integrations.mcp_gateway import McpToolDescriptor, McpToolResult

from .config import GatewayServiceConfig, StdioMcpTransportConfig


class McpTransportError(RuntimeError):
    """Raised when the live MCP transport cannot safely complete a request."""


class StdioMcpTransport:
    """Minimal stdio MCP client for one configured server identity.

    The gateway keeps a single child process and serializes JSON-RPC over
    stdin/stdout. That keeps the implementation small and deterministic while
    still exercising the real MCP transport boundary.
    """

    def __init__(self, config: StdioMcpTransportConfig) -> None:
        self._config = config
        self._process: asyncio.subprocess.Process | None = None
        self._stderr_task: asyncio.Task[None] | None = None
        self._stderr_tail: deque[str] = deque(maxlen=50)
        self._initialized = False
        self._lock = asyncio.Lock()
        self._next_request_id = 0

    async def describe_tool(self, server: str, tool: str) -> McpToolDescriptor:
        for descriptor in await self.list_tools(server):
            if descriptor.name == tool:
                return descriptor
        raise McpTransportError(
            f"MCP tool is not advertised by configured server {server}: {tool}"
        )

    async def list_tools(self, server: str) -> list[McpToolDescriptor]:
        self._assert_server_name(server)
        result = await self._request("tools/list", {})
        if not isinstance(result, dict):
            raise McpTransportError("MCP tools/list returned a non-object result")
        raw_tools = result.get("tools")
        if not isinstance(raw_tools, list):
            raise McpTransportError("MCP tools/list result.tools must be an array")

        descriptors: list[McpToolDescriptor] = []
        for raw_tool in raw_tools:
            if not isinstance(raw_tool, dict):
                raise McpTransportError("MCP tools/list emitted a non-object tool entry")
            name = raw_tool.get("name")
            if not isinstance(name, str) or not name:
                raise McpTransportError("MCP tools/list entry requires a non-empty name")
            input_schema = raw_tool.get("inputSchema") or {}
            if not isinstance(input_schema, dict):
                raise McpTransportError(
                    f"MCP tool {name} inputSchema must be an object"
                )
            annotations = raw_tool.get("annotations")
            if annotations is not None and not isinstance(annotations, dict):
                raise McpTransportError(
                    f"MCP tool {name} annotations must be an object when present"
                )
            description = raw_tool.get("description")
            if description is not None and not isinstance(description, str):
                raise McpTransportError(
                    f"MCP tool {name} description must be a string when present"
                )
            descriptors.append(
                McpToolDescriptor(
                    server=self._config.server_name,
                    name=name,
                    input_schema=input_schema,
                    declared_read_only=bool(
                        isinstance(annotations, dict)
                        and annotations.get("readOnlyHint") is True
                    ),
                    description=description,
                )
            )
        return descriptors

    async def call_tool(
        self, server: str, tool: str, arguments: dict[str, Any]
    ) -> McpToolResult:
        self._assert_server_name(server)
        result = await self._request(
            "tools/call",
            {
                "name": tool,
                "arguments": dict(arguments),
            },
        )
        if not isinstance(result, dict):
            raise McpTransportError("MCP tools/call returned a non-object result")
        if result.get("isError") is True:
            raise McpTransportError(
                f"MCP tool {server}/{tool} reported isError=true: {result}"
            )
        metadata: dict[str, Any] = {}
        if "content" in result:
            metadata["content"] = result["content"]
        if "_meta" in result:
            metadata["mcp_meta"] = result["_meta"]
        external_id = None
        meta = result.get("_meta")
        if isinstance(meta, dict):
            candidate = meta.get("externalId")
            if isinstance(candidate, str) and candidate:
                external_id = candidate
        return McpToolResult(
            content=_normalized_tool_output(result),
            external_id=external_id,
            metadata=metadata,
        )

    async def close(self) -> None:
        async with self._lock:
            process = self._process
            stderr_task = self._stderr_task
            self._process = None
            self._stderr_task = None
            self._initialized = False

        if process is None:
            if stderr_task is not None:
                stderr_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await stderr_task
            return

        if process.stdin is not None and not process.stdin.is_closing():
            process.stdin.close()

        try:
            await asyncio.wait_for(process.wait(), timeout=2.0)
        except asyncio.TimeoutError:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), timeout=2.0)
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()

        if stderr_task is not None:
            stderr_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await stderr_task

    async def _request(self, method: str, params: dict[str, Any]) -> Any:
        async with self._lock:
            await self._ensure_initialized_locked()
            return await self._request_locked(
                method,
                params,
                require_initialized=True,
            )

    async def _ensure_initialized_locked(self) -> None:
        await self._ensure_process_locked()
        if self._initialized:
            return

        result = await self._request_locked(
            "initialize",
            {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": {
                    "name": "correct-once-gateway",
                    "version": "0.16.0-host-path",
                },
            },
            require_initialized=False,
        )
        if not isinstance(result, dict):
            raise McpTransportError("MCP initialize returned a non-object result")
        capabilities = result.get("capabilities")
        if not isinstance(capabilities, dict) or "tools" not in capabilities:
            raise McpTransportError(
                "MCP server did not advertise the required tools capability"
            )
        await self._notify_locked("notifications/initialized")
        self._initialized = True

    async def _ensure_process_locked(self) -> None:
        process = self._process
        if process is not None and process.returncode is None:
            return

        env = os.environ.copy()
        env.update(self._config.env_overrides)
        process = await asyncio.create_subprocess_exec(
            self._config.command,
            *self._config.args,
            cwd=(
                str(self._config.cwd)
                if isinstance(self._config.cwd, Path)
                else self._config.cwd
            ),
            env=env,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        self._process = process
        self._initialized = False
        self._next_request_id = 0
        self._stderr_tail.clear()
        self._stderr_task = asyncio.create_task(self._drain_stderr(process))

    async def _drain_stderr(self, process: asyncio.subprocess.Process) -> None:
        if process.stderr is None:
            return
        while True:
            line = await process.stderr.readline()
            if not line:
                return
            self._stderr_tail.append(line.decode("utf-8", errors="replace").rstrip())

    async def _notify_locked(self, method: str) -> None:
        process = self._require_process()
        assert process.stdin is not None
        message = {"jsonrpc": "2.0", "method": method}
        process.stdin.write(
            json.dumps(message, separators=(",", ":")).encode("utf-8") + b"\n"
        )
        await asyncio.wait_for(
            process.stdin.drain(),
            timeout=self._config.startup_timeout_seconds,
        )

    async def _request_locked(
        self,
        method: str,
        params: dict[str, Any],
        *,
        require_initialized: bool,
    ) -> Any:
        if require_initialized and not self._initialized:
            raise McpTransportError(
                f"MCP request {method} cannot run before initialization"
            )
        process = self._require_process()
        if process.stdin is None or process.stdout is None:
            raise McpTransportError("MCP child process stdio is unavailable")

        self._next_request_id += 1
        request_id = self._next_request_id
        message = {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
            "params": params,
        }
        process.stdin.write(
            json.dumps(message, separators=(",", ":")).encode("utf-8") + b"\n"
        )
        timeout = (
            self._config.startup_timeout_seconds
            if method == "initialize"
            else self._config.request_timeout_seconds
        )
        await asyncio.wait_for(process.stdin.drain(), timeout=timeout)

        while True:
            raw_line = await asyncio.wait_for(process.stdout.readline(), timeout=timeout)
            if raw_line == b"":
                raise McpTransportError(
                    f"MCP server exited while waiting for {method} response."
                    f"{self._stderr_suffix()}"
                )
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError as exc:
                raise McpTransportError(
                    f"MCP server emitted invalid JSON: {line!r}"
                ) from exc
            if not isinstance(payload, dict):
                raise McpTransportError("MCP server emitted a non-object JSON-RPC message")
            if "id" not in payload:
                continue
            if payload.get("id") != request_id:
                raise McpTransportError(
                    f"unexpected MCP response id {payload.get('id')} while waiting for {request_id}"
                )
            if "error" in payload:
                raise McpTransportError(
                    f"MCP request {method} failed: {payload['error']}"
                )
            if "result" not in payload:
                raise McpTransportError(
                    f"MCP request {method} returned no result field"
                )
            return payload["result"]

    def _require_process(self) -> asyncio.subprocess.Process:
        process = self._process
        if process is None:
            raise McpTransportError("MCP process is not running")
        if process.returncode is not None:
            raise McpTransportError(
                f"MCP process exited with {process.returncode}.{self._stderr_suffix()}"
            )
        return process

    def _stderr_suffix(self) -> str:
        if not self._stderr_tail:
            return ""
        return "\nRecent MCP stderr:\n" + "\n".join(self._stderr_tail)

    def _assert_server_name(self, server: str) -> None:
        if server != self._config.server_name:
            raise McpTransportError(
                f"configured MCP server is {self._config.server_name}; received {server}"
            )


def _normalized_tool_output(result: dict[str, Any]) -> Any:
    structured_content = result.get("structuredContent")
    if structured_content is not None:
        return structured_content

    content = result.get("content")
    if not isinstance(content, list):
        return content
    if len(content) == 1 and isinstance(content[0], dict):
        entry = content[0]
        if entry.get("type") == "json" and "json" in entry:
            return entry["json"]
        if entry.get("type") == "text" and isinstance(entry.get("text"), str):
            return entry["text"]
    return content


def build_transport(config: GatewayServiceConfig) -> StdioMcpTransport:
    if config.transport_kind != "stdio":
        raise McpTransportError(
            f"unsupported transport kind: {config.transport_kind!r}"
        )
    return StdioMcpTransport(config.stdio)
