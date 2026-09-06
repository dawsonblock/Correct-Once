"""Partial PALO Agentic Effect Contract compatibility.

v0.2.x intentionally supports only predicates that can be represented faithfully by Effect Fabric's
current pre-state/post-state verifier: `exists`, `notExists`, `equals`, and `changedTo`.
Operators requiring simultaneous pre/post arithmetic or type semantics are rejected rather than
silently weakened.
"""
from __future__ import annotations

from typing import Any

from ..models import EffectContract, Predicate


_OPERATOR_MAP = {
    "exists": "exists",
    "notExists": "not_exists",
    "equals": "eq",
    "changedTo": "eq",
}


def _predicate(raw: dict[str, Any]) -> Predicate:
    op = raw.get("operator")
    if op not in _OPERATOR_MAP:
        raise ValueError(f"PALO predicate operator not faithfully supported in v0.2.x: {op!r}")
    return Predicate(
        path=str(raw.get("path", "")),
        operator=_OPERATOR_MAP[op],
        value=raw.get("value"),
    )


def effect_contract_from_palo(raw: dict[str, Any], *, verifier: str) -> EffectContract:
    if raw.get("format") != "palo-agentic-effect-contract":
        raise ValueError("not a PALO agentic Effect Contract")
    if raw.get("schemaVersion") not in {"1.0.0", "1.1.0"}:
        raise ValueError("unsupported PALO Effect Contract schemaVersion")
    selector = raw.get("resourceSelector")
    if not isinstance(selector, dict):
        raise ValueError("PALO Effect Contract missing resourceSelector")
    resource = f"{selector.get('resource', '')}:{selector.get('path', '')}"
    verification = raw.get("verification") or {}
    max_attempts = int(verification.get("maxAttempts", 1))
    return EffectContract(
        schema_version=f"palo-agentic-effect-contract/{raw['schemaVersion']}",
        resource=resource,
        preconditions=[_predicate(p) for p in raw.get("preconditions", [])],
        expected=[_predicate(p) for p in raw.get("expectedEffects", [])],
        forbidden=[_predicate(p) for p in raw.get("forbiddenEffects", [])],
        verifier=verifier,
        max_verification_attempts=max_attempts,
    )
