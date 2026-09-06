from __future__ import annotations

from typing import Any

from .models import EffectContract, OutcomeAttestation, Predicate, VerificationState


_MISSING = object()


def _resolve(state: dict[str, Any], path: str) -> Any:
    current: Any = state
    if path in {"", "$"}:
        return current
    if path.startswith("/"):
        parts = [part.replace("~1", "/").replace("~0", "~") for part in path.split("/")[1:]]
    else:
        cleaned = path[2:] if path.startswith("$.") else path
        parts = cleaned.split(".")
    for part in parts:
        if isinstance(current, dict) and part in current:
            current = current[part]
        else:
            return _MISSING
    return current


def evaluate(predicate: Predicate, state: dict[str, Any]) -> bool:
    actual = _resolve(state, predicate.path)
    op = predicate.operator
    if op == "exists":
        return actual is not _MISSING
    if op == "not_exists":
        return actual is _MISSING
    if actual is _MISSING:
        return False
    if op == "eq":
        return actual == predicate.value
    if op == "ne":
        return actual != predicate.value
    if op == "contains":
        try:
            return predicate.value in actual
        except TypeError:
            return False
    if op == "not_contains":
        try:
            return predicate.value not in actual
        except TypeError:
            return False
    raise ValueError(f"unsupported predicate operator: {op}")


def attest(verifier: str, contract: EffectContract, state: dict[str, Any]) -> OutcomeAttestation:
    matched: list[str] = []
    mismatched: list[str] = []
    for pred in contract.expected:
        label = f"expected:{pred.path}:{pred.operator}"
        (matched if evaluate(pred, state) else mismatched).append(label)
    for pred in contract.forbidden:
        label = f"forbidden:{pred.path}:{pred.operator}"
        # A forbidden predicate describes a state that must NOT be true.
        (mismatched if evaluate(pred, state) else matched).append(label)
    return OutcomeAttestation(
        verifier=verifier,
        contract_digest=contract.digest,
        state=VerificationState.VERIFIED if not mismatched else VerificationState.MISMATCH,
        matched=matched,
        mismatched=mismatched,
    )
