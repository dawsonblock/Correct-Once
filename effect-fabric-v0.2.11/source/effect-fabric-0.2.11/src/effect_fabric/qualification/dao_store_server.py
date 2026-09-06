"""JSON-lines RPC server exposing :class:`DaoSqliteStoreAdapter` to the TypeScript donor suite."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from .dao_store import DaoSqliteStoreAdapter


def _ok(request_id: int, result: Any) -> dict[str, Any]:
    return {"id": request_id, "ok": True, "result": result}


def _error(request_id: int, exc: BaseException) -> dict[str, Any]:
    return {
        "id": request_id,
        "ok": False,
        "error": {"type": type(exc).__name__, "message": str(exc)},
    }


def dispatch(store: DaoSqliteStoreAdapter, method: str, params: dict[str, Any]) -> Any:
    if method == "loadAction":
        return store.load_action(params["id"])
    if method == "findBySubject":
        return store.find_by_subject(params["subject"])
    if method == "findByIdempotencyKey":
        return store.find_by_idempotency_key(params["key"])
    if method == "commit":
        return store.commit(
            expected_revision=params.get("expectedRevision"),
            action=params["action"],
            events=params.get("events", []),
        )
    if method == "claimNext":
        return store.claim_next(int(params["now"]))
    if method == "listInDoubt":
        return store.list_in_doubt()
    if method == "listRetryable":
        return store.list_retryable()
    if method == "listAttempting":
        return store.list_attempting()
    if method == "readAudit":
        return store.read_audit(params.get("actionId"))
    if method == "nextAuditSeq":
        return store.next_audit_seq()
    raise ValueError(f"unknown RPC method: {method}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, required=True)
    args = parser.parse_args()
    store = DaoSqliteStoreAdapter(args.db)
    try:
        for raw in sys.stdin:
            raw = raw.strip()
            if not raw:
                continue
            request: dict[str, Any] = json.loads(raw)
            request_id = int(request["id"])
            try:
                response = _ok(
                    request_id,
                    dispatch(store, str(request["method"]), dict(request.get("params") or {})),
                )
            except Exception as exc:  # RPC boundary: return structured failure, keep server alive.
                response = _error(request_id, exc)
            sys.stdout.write(json.dumps(response, sort_keys=True, separators=(",", ":")) + "\n")
            sys.stdout.flush()
    finally:
        store.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
