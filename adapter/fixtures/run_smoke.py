#!/usr/bin/env python3
"""MIRRORED gate smoke — does NOT import effect_fabric / does NOT prove live A integration.

Four Security Expert fixtures + composition-lock brand checks only.
"""
from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

FIX = Path(__file__).resolve().parent
sys.path.insert(0, str(FIX.parent / "python"))
from side_effect_map import map_side_effect  # noqa: E402

failures: list[str] = []


class Denied(RuntimeError):
    pass


@dataclass(frozen=True)
class SubjectAllowlist:
    allowed_classes: frozenset[str] = field(default_factory=lambda: frozenset({"read"}))
    allow_destructive: bool = False


def parse_active_mcp_pin(record: dict) -> dict:
    """Mirror curated_mcp_adapter.parse_active_mcp_pin fail-closed gates (no A imports)."""
    if record.get("state") != "active":
        raise Denied(f"not active: {record.get('state')!r}")
    cap = record["capability"]
    if cap.get("lifecycle") != "admitted":
        raise Denied("not admitted")
    provenance = cap["provenance"]
    if provenance.get("version") == "latest":
        raise Denied("refuse floating provenance.version=latest")
    schema_hash = cap.get("schemaHash")
    schema_digest = provenance.get("schemaDigest")
    if not schema_hash or not schema_digest:
        raise Denied("missing schema digest/hash")
    if schema_digest != schema_hash:
        raise Denied("provenance.schemaDigest != schemaHash")
    if cap.get("implementation", {}).get("kind") != "mcp":
        raise Denied("kind must be mcp")
    side = cap["sideEffect"]
    mapped = map_side_effect(side)
    return {
        "id": cap["id"],
        "sideEffect": side,
        "catalogTag": mapped.catalog_tag,
        "mutation_class": mapped.mutation_class,
        "server": cap["implementation"]["server"],
        "tool": cap["implementation"]["tool"],
    }


def expect_denied(label: str, fn):
    try:
        fn()
        failures.append(f"{label}: expected Denied")
    except Denied as exc:
        print(f"PASS {label}: {exc}")
    except Exception as exc:  # noqa: BLE001
        if "refuse" in str(exc).lower() or "sideEffect" in str(exc):
            print(f"PASS {label}: {exc}")
        else:
            failures.append(f"{label}: unexpected {type(exc).__name__}: {exc}")


rec = json.loads((FIX / "digest_mismatch_record.json").read_text())
expect_denied("digest_mismatch", lambda: parse_active_mcp_pin(rec))

dest = json.loads((FIX / "destructive_cap_record.json").read_text())
pin = parse_active_mcp_pin(dest)
assert pin["catalogTag"] == "destructive"
assert pin["mutation_class"] == "destructive"
allow = SubjectAllowlist()
denied = pin["catalogTag"] not in allow.allowed_classes or (
    pin["catalogTag"] == "destructive" and not allow.allow_destructive
)
if denied:
    print("PASS destructive_denied_by_default")
else:
    failures.append("destructive_default: not denied")

allow_on = SubjectAllowlist(
    allowed_classes=frozenset({"read", "write", "destructive"}),
    allow_destructive=True,
)
if pin["catalogTag"] in allow_on.allowed_classes and allow_on.allow_destructive:
    print("PASS destructive_allowed_when_flag_on")
else:
    failures.append("destructive_allowed: still denied")

routes = json.loads((FIX / "manual_routes_mcp.json").read_text())


def assert_no_manual_mcp(routes_list):
    for route in routes_list:
        if route.get("backend") == "mcp" or route.get("event") == "mcp.call":
            raise Denied(
                f"refuse manualRoutes for MCP ({route.get('app')}/{route.get('capability')})"
            )


expect_denied("manualRoutes_mcp_refuse", lambda: assert_no_manual_mcp(routes))

LOCK = "adapter.effectGatewayMcpCall.v1"


def assert_locked(adapters: dict):
    fn = adapters.get("mcp.call")
    if fn is None or getattr(fn, LOCK, None) is not True:
        raise Denied('composition lock failed: adapters["mcp.call"] must be createLockedMcpCall')


def locked():
    async def _c(i, c):
        return {"ok": True}

    setattr(_c, LOCK, True)
    return _c


def raw():
    async def _c(i, c):
        raise RuntimeError("raw")

    return _c


try:
    assert_locked({"mcp.call": raw()})
    failures.append("composition_lock_raw: expected deny")
except Denied as exc:
    print(f"PASS composition_lock_rejects_raw: {exc}")

try:
    assert_locked({"mcp.call": locked()})
    print("PASS composition_lock_accepts_locked")
except Denied as exc:
    failures.append(f"composition_lock_locked: {exc}")

if failures:
    print("FAIL")
    for f in failures:
        print(" -", f)
    sys.exit(1)
print("ALL FIXTURE SMOKES PASSED")
print("NOTE: mirrored gates only — not a live effect_fabric import")
