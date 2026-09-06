"""Deterministic action canonicalization.

This v0.1 profile intentionally rejects floating-point arguments. External actions should
use integers (for example cents) or strings/Decimals encoded as strings. That removes the
cross-language floating-number ambiguity that makes ad-hoc canonical JSON unsafe.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any


def _validate(value: Any, path: str = "$") -> None:
    if isinstance(value, float):
        raise TypeError(f"floating-point value not allowed in canonical action at {path}")
    if value is None or isinstance(value, (str, int, bool)):
        return
    if isinstance(value, list):
        for i, child in enumerate(value):
            _validate(child, f"{path}[{i}]")
        return
    if isinstance(value, dict):
        for key, child in value.items():
            if not isinstance(key, str):
                raise TypeError(f"non-string key not allowed in canonical action at {path}")
            _validate(child, f"{path}.{key}")
        return
    raise TypeError(f"unsupported canonical action type {type(value).__name__} at {path}")


def canonical_json(value: Any) -> bytes:
    _validate(value)
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")


def sha256_hex(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def digest_document(value: Any) -> str:
    return sha256_hex(canonical_json(value))
