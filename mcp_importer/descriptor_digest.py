from __future__ import annotations

import hashlib
import json
from typing import Any

from .normalize import NormalizedMcpTool


def _canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("utf-8")


def descriptor_digest(tool: NormalizedMcpTool) -> str:
    annotations = {
        key: value
        for key, value in {
            "readOnlyHint": tool.annotations.read_only_hint,
            "destructiveHint": tool.annotations.destructive_hint,
            "idempotentHint": tool.annotations.idempotent_hint,
            "openWorldHint": tool.annotations.open_world_hint,
        }.items()
        if value is not None
    }
    return hashlib.sha256(
        _canonical_json(
            {
                "server": tool.server,
                "name": tool.name,
                "description": tool.description,
                "inputSchema": tool.input_schema,
                "annotations": annotations,
                "verifiedReadOnly": tool.verified_read_only,
            }
        )
    ).hexdigest()
