from __future__ import annotations

from pathlib import Path
from typing import Any

import effect_fabric
from fastapi import HTTPException

from effect_fabric.gateway_api import create_gateway_app

from .authority import build_live_gateway
from .config import GatewayServiceConfig
from .transport import build_transport


def create_app(config: GatewayServiceConfig):
    transport = build_transport(config)
    gateway, pins_by_mcp = build_live_gateway(
        snapshot_path=config.snapshot_path,
        transport=transport,
        policy_version=config.policy_version,
        approval_secret=config.approval_secret,
        approval_required_operations=config.approval_required_operations,
        worker_id=config.worker_id,
        capability_ttl_seconds=config.capability_ttl_seconds,
        lease_seconds=config.lease_seconds,
        auto_reconcile_unknown=config.auto_reconcile_unknown,
        auto_verify=config.auto_verify,
    )
    app = create_gateway_app(gateway, api_token=config.bearer_token)

    @app.on_event("shutdown")
    async def close_transport() -> None:
        await transport.close()

    @app.get("/debug/environment")
    async def environment() -> dict[str, Any]:
        return {
            "effect_fabric_version": effect_fabric.__version__,
            "effect_fabric_module": str(Path(effect_fabric.__file__).resolve()),
            "snapshot_path": str(config.snapshot_path),
            "transport_kind": config.transport_kind,
            "registered_tools": sorted(
                f"{server}/{tool}" for server, tool in pins_by_mcp.keys()
            ),
        }

    @app.get("/debug/transactions/{transaction_id}")
    async def transaction(transaction_id: str) -> dict[str, Any]:
        try:
            tx = await gateway.engine.store.get_transaction(transaction_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="transaction not found") from exc
        return tx.model_dump(mode="json")

    return app
