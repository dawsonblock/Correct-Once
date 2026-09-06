#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from effect_fabric.qualification.provenance import PACKAGE_VERSION, bind_document

ROOT = Path(__file__).resolve().parents[1]

# These reports are generated earlier in qualify.sh. This check intentionally does not
# rerun provider/network-style qualification logic: it proves that the complete local
# qualification evidence set has a stable canonical representation for this source tree.
REPORTS = (
    "CORE_TEST_QUALIFICATION.json",
    "PROVIDER_QUALIFICATION.json",
    "EVIDENCE_QUALIFICATION.json",
    "TRANSACTIONAL_EVIDENCE_QUALIFICATION.json",
    "DONOR_COMPATIBILITY_QUALIFICATION.json",
    "TRANSITION_KERNEL_QUALIFICATION.json",
    "GATEWAY_QUALIFICATION.json",
    "WORKLOAD_IDENTITY_QUALIFICATION.json",
    "EXTERNAL_ANCHOR_QUALIFICATION.json",
    "REDUCER_EQUIVALENCE_QUALIFICATION.json",
    "REDUCER_NEGATIVE_CONTROL_QUALIFICATION.json",
    "STATIC_QUALIFICATION.json",
    "POSTGRES_QUALIFICATION.json",
    "UPSTREAM_DAO_QUALIFICATION.json",
    "UPSTREAM_DAO_REPRODUCIBILITY.json",
    "UPSTREAM_DAO_DIRECT_STORE_QUALIFICATION.json",
    "UPSTREAM_DAO_DIRECT_STORE_REPRODUCIBILITY.json",
    "UPSTREAM_DAO_ENGINE_INTERFACE_QUALIFICATION.json",
    "UPSTREAM_DAO_ENGINE_INTERFACE_REPRODUCIBILITY.json",
    "UPSTREAM_DAO_ACTIVE_ENGINE_QUALIFICATION.json",
    "UPSTREAM_DAO_ACTIVE_ENGINE_REPRODUCIBILITY.json",
    "UPSTREAM_DAO_NATIVE_ENGINE_QUALIFICATION.json",
    "UPSTREAM_DAO_NATIVE_ENGINE_REPRODUCIBILITY.json",
)


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode(
        "utf-8"
    )


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _load(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def snapshot() -> tuple[dict[str, dict[str, object]], list[str]]:
    reports: dict[str, dict[str, object]] = {}
    failures: list[str] = []
    for name in REPORTS:
        path = ROOT / name
        if not path.is_file():
            failures.append(f"missing:{name}")
            continue
        try:
            first = _load(path)
            second = _load(path)
        except (OSError, json.JSONDecodeError) as exc:
            failures.append(f"invalid:{name}:{type(exc).__name__}")
            continue
        first_bytes = _canonical_bytes(first)
        second_bytes = _canonical_bytes(second)
        if first_bytes != second_bytes:
            failures.append(f"unstable-read:{name}")
        reports[name] = {
            "canonical_sha256": _sha256(first_bytes),
            "canonical_bytes": len(first_bytes),
        }
    return reports, failures


def main() -> int:
    first, first_failures = snapshot()
    second, second_failures = snapshot()
    failures = first_failures + second_failures
    if first != second:
        failures.append("qualification-evidence-snapshot-changed")

    status = "PASS" if not failures else "FAIL"
    document = bind_document(
        {
            "schema": "effect-fabric/qualification-artifact-determinism/v1",
            "version": PACKAGE_VERSION,
            "status": status,
            "claim": (
                "Generated local qualification artifacts have a stable canonical JSON "
                "representation for the current qualification input tree; this gate does "
                "not claim external-system or timing reproducibility."
            ),
            "reports": first,
            "aggregate_sha256": _sha256(_canonical_bytes(first)),
            "failures": failures,
        },
        ROOT,
    )
    print(json.dumps(document, indent=2, sort_keys=True))
    return 0 if status == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
