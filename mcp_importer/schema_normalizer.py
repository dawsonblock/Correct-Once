from __future__ import annotations

import copy
from typing import Any


def normalize_schema(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError("MCP inputSchema must be a JSON object")
    return copy.deepcopy(value)
