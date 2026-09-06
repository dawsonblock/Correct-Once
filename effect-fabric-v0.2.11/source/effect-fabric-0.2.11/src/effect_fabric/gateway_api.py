"""Optional HTTP surface for Effect Gateway.

This is an authenticated service wrapper, not an MCP SDK implementation.  Hosts can mount the same
``EffectGateway`` object behind an MCP server adapter, local IPC, or this HTTP endpoint.
"""
from __future__ import annotations

import hmac
import os
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from .gateway import EffectGateway, GatewayApprovalRequired, GatewayDenied


class GatewayToolCall(BaseModel):
    model_config = ConfigDict(extra="forbid")

    subject: str
    server: str
    tool: str
    arguments: dict[str, Any] = Field(default_factory=dict)
    trace_id: str | None = None
    approval_token: str | None = None


def create_gateway_app(gateway: EffectGateway, *, api_token: str | None = None):
    try:
        from fastapi import Depends, FastAPI, Header, HTTPException
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("install effect-fabric[api]") from exc

    token = api_token or os.getenv("EFFECT_FABRIC_GATEWAY_TOKEN")
    if not token:
        raise RuntimeError("Effect Gateway API requires EFFECT_FABRIC_GATEWAY_TOKEN/api_token")

    app = FastAPI(title="Effect Fabric Gateway", version="0.2.11")

    async def require_token(authorization: str | None = Header(default=None)) -> None:
        prefix = "Bearer "
        if not authorization or not authorization.startswith(prefix):
            raise HTTPException(status_code=401, detail="authentication required")
        if not hmac.compare_digest(authorization[len(prefix) :], token):
            raise HTTPException(status_code=403, detail="forbidden")

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/gateway/tool-call", dependencies=[Depends(require_token)])
    async def tool_call(request: GatewayToolCall) -> dict[str, Any]:
        try:
            result = await gateway.call_tool(
                subject=request.subject,
                server=request.server,
                tool=request.tool,
                arguments=request.arguments,
                trace_id=request.trace_id,
                approval_token=request.approval_token,
            )
        except GatewayApprovalRequired as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except GatewayDenied as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        return result.model_dump(mode="json")

    return app
