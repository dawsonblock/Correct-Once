"""JSON-lines RPC server for the direct upstream DAO engine-interface shadow."""
from __future__ import annotations

import json
import sys
from typing import Any

from .dao_engine_shadow import DaoEngineInvariantShadow


def main() -> int:
    shadow = DaoEngineInvariantShadow()
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        request: dict[str, Any] = json.loads(raw)
        request_id = int(request["id"])
        try:
            if request["method"] != "observe":
                raise ValueError(f"unknown RPC method: {request['method']}")
            params = dict(request.get("params") or {})
            result = shadow.observe(
                list(params.get("actions") or []),
                list(params.get("audit") or []),
            )
            response = {"id": request_id, "ok": True, "result": result}
        except Exception as exc:
            response = {
                "id": request_id,
                "ok": False,
                "error": {"type": type(exc).__name__, "message": str(exc)},
            }
        sys.stdout.write(json.dumps(response, sort_keys=True, separators=(",", ":")) + "\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
