from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping


class GatewayConfigError(RuntimeError):
    """Raised when the live gateway configuration is incomplete or unsafe."""


def _require_text(value: str | None, field: str) -> str:
    normalized = (value or "").strip()
    if not normalized:
        raise GatewayConfigError(f"{field} must be a non-empty string")
    return normalized


def _optional_text(value: str | None) -> str | None:
    normalized = (value or "").strip()
    return normalized or None


def _parse_positive_int(value: str | None, field: str, default: int) -> int:
    if value is None or value.strip() == "":
        return default
    try:
        parsed = int(value)
    except ValueError as exc:
        raise GatewayConfigError(f"{field} must be an integer") from exc
    if parsed <= 0:
        raise GatewayConfigError(f"{field} must be > 0")
    return parsed


def _parse_positive_float(value: str | None, field: str, default: float) -> float:
    if value is None or value.strip() == "":
        return default
    try:
        parsed = float(value)
    except ValueError as exc:
        raise GatewayConfigError(f"{field} must be a number") from exc
    if parsed <= 0:
        raise GatewayConfigError(f"{field} must be > 0")
    return parsed


def _parse_bool(value: str | None, field: str, default: bool) -> bool:
    if value is None or value.strip() == "":
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise GatewayConfigError(f"{field} must be a boolean-like value")


def _parse_json_array(value: str | None, field: str) -> tuple[str, ...]:
    if value is None or value.strip() == "":
        return ()
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise GatewayConfigError(f"{field} must be valid JSON") from exc
    if not isinstance(parsed, list) or not all(isinstance(entry, str) for entry in parsed):
        raise GatewayConfigError(f"{field} must be a JSON array of strings")
    return tuple(parsed)


def _parse_json_object(value: str | None, field: str) -> dict[str, str]:
    if value is None or value.strip() == "":
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise GatewayConfigError(f"{field} must be valid JSON") from exc
    if not isinstance(parsed, dict):
        raise GatewayConfigError(f"{field} must be a JSON object")
    normalized: dict[str, str] = {}
    for key, entry in parsed.items():
        if not isinstance(key, str) or not key.strip():
            raise GatewayConfigError(f"{field} keys must be non-empty strings")
        if not isinstance(entry, str):
            raise GatewayConfigError(f"{field}.{key} must be a string")
        normalized[key] = entry
    return normalized


def _parse_csv_set(value: str | None) -> frozenset[str]:
    if value is None or value.strip() == "":
        return frozenset()
    items = [entry.strip() for entry in value.split(",")]
    return frozenset(entry for entry in items if entry)


@dataclass(frozen=True)
class StdioMcpTransportConfig:
    server_name: str
    command: str
    args: tuple[str, ...] = ()
    cwd: Path | None = None
    env_overrides: dict[str, str] = field(default_factory=dict)
    request_timeout_seconds: float = 15.0
    startup_timeout_seconds: float = 15.0


@dataclass(frozen=True)
class GatewayServiceConfig:
    snapshot_path: Path
    bearer_token: str
    host: str
    port: int
    policy_version: str
    approval_secret: str | None
    approval_required_operations: frozenset[str]
    worker_id: str
    capability_ttl_seconds: int
    lease_seconds: int
    auto_reconcile_unknown: bool
    auto_verify: bool
    transport_kind: str
    stdio: StdioMcpTransportConfig

    @classmethod
    def from_env(
        cls, environ: Mapping[str, str] | None = None
    ) -> GatewayServiceConfig:
        env = dict(os.environ if environ is None else environ)
        snapshot_path = Path(
            _require_text(
                env.get("EFFECT_GATEWAY_SNAPSHOT_PATH"),
                "EFFECT_GATEWAY_SNAPSHOT_PATH",
            )
        ).expanduser()
        if not snapshot_path.is_file():
            raise GatewayConfigError(
                f"EFFECT_GATEWAY_SNAPSHOT_PATH must point to an existing file: {snapshot_path}"
            )

        host = _optional_text(env.get("EFFECT_GATEWAY_HOST")) or "0.0.0.0"
        port = _parse_positive_int(
            env.get("PORT") or env.get("EFFECT_GATEWAY_PORT"),
            "PORT/EFFECT_GATEWAY_PORT",
            default=8000,
        )
        token = _require_text(env.get("EFFECT_GATEWAY_TOKEN"), "EFFECT_GATEWAY_TOKEN")
        transport_kind = (
            _optional_text(env.get("EFFECT_GATEWAY_MCP_TRANSPORT")) or "stdio"
        ).lower()
        if transport_kind != "stdio":
            raise GatewayConfigError(
                "EFFECT_GATEWAY_MCP_TRANSPORT currently supports only 'stdio'"
            )

        if _parse_bool(
            env.get("EFFECT_GATEWAY_ALLOW_UNREGISTERED_READS"),
            "EFFECT_GATEWAY_ALLOW_UNREGISTERED_READS",
            default=False,
        ):
            raise GatewayConfigError(
                "Correct-Once refuses allow_unregistered_reads=true; unknown MCP tools stay denied until admitted."
            )

        return cls(
            snapshot_path=snapshot_path,
            bearer_token=token,
            host=host,
            port=port,
            policy_version=(
                _optional_text(env.get("EFFECT_GATEWAY_POLICY_VERSION"))
                or "correct-once/live-authority/v0.16"
            ),
            approval_secret=_optional_text(env.get("EFFECT_GATEWAY_APPROVAL_SECRET")),
            approval_required_operations=_parse_csv_set(
                env.get("EFFECT_GATEWAY_APPROVAL_REQUIRED_OPERATIONS")
            ),
            worker_id=(
                _optional_text(env.get("EFFECT_GATEWAY_WORKER_ID"))
                or "correct-once-gateway"
            ),
            capability_ttl_seconds=_parse_positive_int(
                env.get("EFFECT_GATEWAY_CAPABILITY_TTL_SECONDS"),
                "EFFECT_GATEWAY_CAPABILITY_TTL_SECONDS",
                default=60,
            ),
            lease_seconds=_parse_positive_int(
                env.get("EFFECT_GATEWAY_LEASE_SECONDS"),
                "EFFECT_GATEWAY_LEASE_SECONDS",
                default=30,
            ),
            auto_reconcile_unknown=_parse_bool(
                env.get("EFFECT_GATEWAY_AUTO_RECONCILE_UNKNOWN"),
                "EFFECT_GATEWAY_AUTO_RECONCILE_UNKNOWN",
                default=True,
            ),
            auto_verify=_parse_bool(
                env.get("EFFECT_GATEWAY_AUTO_VERIFY"),
                "EFFECT_GATEWAY_AUTO_VERIFY",
                default=True,
            ),
            transport_kind=transport_kind,
            stdio=StdioMcpTransportConfig(
                server_name=_require_text(
                    env.get("EFFECT_GATEWAY_MCP_SERVER_NAME"),
                    "EFFECT_GATEWAY_MCP_SERVER_NAME",
                ),
                command=_require_text(
                    env.get("EFFECT_GATEWAY_MCP_COMMAND"),
                    "EFFECT_GATEWAY_MCP_COMMAND",
                ),
                args=_parse_json_array(
                    env.get("EFFECT_GATEWAY_MCP_ARGS_JSON"),
                    "EFFECT_GATEWAY_MCP_ARGS_JSON",
                ),
                cwd=(
                    Path(_require_text(env.get("EFFECT_GATEWAY_MCP_CWD"), "EFFECT_GATEWAY_MCP_CWD")).expanduser()
                    if _optional_text(env.get("EFFECT_GATEWAY_MCP_CWD")) is not None
                    else None
                ),
                env_overrides=_parse_json_object(
                    env.get("EFFECT_GATEWAY_MCP_ENV_JSON"),
                    "EFFECT_GATEWAY_MCP_ENV_JSON",
                ),
                request_timeout_seconds=_parse_positive_float(
                    env.get("EFFECT_GATEWAY_MCP_REQUEST_TIMEOUT_SECONDS"),
                    "EFFECT_GATEWAY_MCP_REQUEST_TIMEOUT_SECONDS",
                    default=15.0,
                ),
                startup_timeout_seconds=_parse_positive_float(
                    env.get("EFFECT_GATEWAY_MCP_STARTUP_TIMEOUT_SECONDS"),
                    "EFFECT_GATEWAY_MCP_STARTUP_TIMEOUT_SECONDS",
                    default=15.0,
                ),
            ),
        )
