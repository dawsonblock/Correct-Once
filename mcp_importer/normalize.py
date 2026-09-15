from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping

from .schema_normalizer import normalize_schema


def _non_empty(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a non-empty string")
    return value.strip()


@dataclass(frozen=True)
class ToolAnnotations:
    read_only_hint: bool | None = None
    destructive_hint: bool | None = None
    idempotent_hint: bool | None = None
    open_world_hint: bool | None = None


@dataclass(frozen=True)
class NormalizedMcpTool:
    server: str
    name: str
    description: str
    input_schema: dict[str, Any] = field(default_factory=dict)
    annotations: ToolAnnotations = field(default_factory=ToolAnnotations)
    verified_read_only: bool = False

    @property
    def search_text(self) -> str:
        return f"{self.name} {self.description}".lower()


def normalize_tool(
    server: str,
    raw_tool: Mapping[str, Any],
    *,
    verified_read_only: bool = False,
) -> NormalizedMcpTool:
    name = _non_empty(raw_tool.get("name"), "tool.name")
    description = raw_tool.get("description")
    if description is None:
        description = name
    description_text = _non_empty(description, "tool.description")
    raw_annotations = raw_tool.get("annotations")
    if raw_annotations is None:
        annotations = ToolAnnotations()
    else:
        if not isinstance(raw_annotations, Mapping):
            raise ValueError("tool.annotations must be an object")
        annotations = ToolAnnotations(
            read_only_hint=(
                raw_annotations.get("readOnlyHint")
                if isinstance(raw_annotations.get("readOnlyHint"), bool)
                else None
            ),
            destructive_hint=(
                raw_annotations.get("destructiveHint")
                if isinstance(raw_annotations.get("destructiveHint"), bool)
                else None
            ),
            idempotent_hint=(
                raw_annotations.get("idempotentHint")
                if isinstance(raw_annotations.get("idempotentHint"), bool)
                else None
            ),
            open_world_hint=(
                raw_annotations.get("openWorldHint")
                if isinstance(raw_annotations.get("openWorldHint"), bool)
                else None
            ),
        )
    return NormalizedMcpTool(
        server=_non_empty(server, "server"),
        name=name,
        description=description_text,
        input_schema=normalize_schema(raw_tool.get("inputSchema")),
        annotations=annotations,
        verified_read_only=verified_read_only,
    )
