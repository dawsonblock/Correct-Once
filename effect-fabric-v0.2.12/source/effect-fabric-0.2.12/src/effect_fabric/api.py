"""Optional FastAPI surface.

The transaction API is fail-closed. It is not mounted unless the caller explicitly enables it and
provides a bearer token. The health endpoint intentionally exposes no ledger or transaction data.
Install ``effect-fabric[api]``.
"""

from __future__ import annotations

import hmac
import os
from typing import Any

from .engine import EffectEngine


def _summary(tx: Any) -> dict[str, Any]:
    """Return a deliberately redacted operator-safe transaction summary."""
    return {
        "transaction_id": tx.transaction_id,
        "subject": tx.intent.subject,
        "operation": tx.intent.operation,
        "resource": tx.intent.resource,
        "execution_state": tx.execution_state.value,
        "verification_state": tx.verification_state.value,
        "recovery_state": tx.recovery_state.value,
        "fencing_epoch": tx.fencing_epoch,
        "created_at": tx.created_at.isoformat(),
        "updated_at": tx.updated_at.isoformat(),
    }


def create_app(
    engine: EffectEngine | None = None,
    *,
    expose_transactions: bool = False,
    api_token: str | None = None,
):
    try:
        from fastapi import Depends, FastAPI, Header, HTTPException
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("install effect-fabric[api]") from exc

    engine = engine or EffectEngine()
    app = FastAPI(title="Effect Fabric", version="0.2.12")

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    if expose_transactions:
        token = api_token or os.getenv("EFFECT_FABRIC_API_TOKEN")
        if not token:
            raise RuntimeError(
                "transaction API requested without EFFECT_FABRIC_API_TOKEN/api_token"
            )

        async def require_token(authorization: str | None = Header(default=None)) -> None:
            prefix = "Bearer "
            if not authorization or not authorization.startswith(prefix):
                raise HTTPException(status_code=401, detail="authentication required")
            presented = authorization[len(prefix) :]
            if not hmac.compare_digest(presented, token):
                raise HTTPException(status_code=403, detail="forbidden")

        @app.get("/transactions/{transaction_id}", dependencies=[Depends(require_token)])
        async def transaction(transaction_id: str) -> dict[str, Any]:
            try:
                tx = await engine.store.get_transaction(transaction_id)
            except KeyError as exc:
                raise HTTPException(status_code=404, detail="not found") from exc
            return _summary(tx)

    return app
