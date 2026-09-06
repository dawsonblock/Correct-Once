"""JSON-lines RPC server for :mod:`effect_fabric.qualification.dao_active_guard`."""
from __future__ import annotations

import json
import sys
from typing import Any

from .dao_active_guard import validate_commit


def main() -> int:
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        request: dict[str, Any] = json.loads(raw)
        request_id = int(request["id"])
        try:
            if request["method"] != "validateCommit":
                raise ValueError(f"unknown RPC method: {request['method']}")
            params = dict(request.get("params") or {})
            result = validate_commit(
                before=params.get("before"),
                expected_revision=params.get("expectedRevision"),
                action=params["action"],
                events=list(params.get("events") or []),
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
