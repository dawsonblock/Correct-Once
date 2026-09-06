"""Crosswalk for the locked durable-agent-outbox conformance package.

The executable upstream suite is run by ``scripts/qualify_upstream_dao.py``. This module contains
only stable identifiers and comparison logic, so importing Effect Fabric never imports donor code.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Mapping

from .donor_conformance import SCENARIO_IDS
from .reducer_mutants import ALL_MUTANTS

UPSTREAM_SCENARIO_TO_INTERNAL: dict[str, str] = {
    "01": "duplicateDelivery",
    "02": "crashAfterIntent",
    "03": "unknownWaitsForReceipt",
    "04": "unknownRevokeLanded",
    "05": "unknownRevokeNotLanded",
    "06": "ackedCannotBecomeRevoked",
    "07": "progressUnderInDoubt",
    "08": "supersessionBefore",
    "09": "supersessionAfter",
    "10": "staleEpochNoop",
    "11": "idempotencyKeyStability",
    "12": "receiptReplayIsNoop",
    "13": "inDoubtDrains",
    "14": "expectedExecutions",
    "15": "receiptSourceCompleteness",
    "16": "forgedReceiptRefused",
    "17": "receiptRedeliveryIsIdempotent",
}

UPSTREAM_MUTANT_TO_INTERNAL: dict[str, str] = {
    "eagerResolve": "eagerResolve",
    "ackedRevoked": "ackedRevoked",
    "strandsInDoubt": "strandsInDoubt",
    "deliveryKeyed": "deliveryKeyed",
    "selfRevoke": "selfRevoke",
    "trustsAnyReceipt": "trustsAnyReceipt",
    "noncesAreConsumed": "noncesAreConsumed",
    "nop": "nop",
}


@dataclass(frozen=True)
class CrosswalkResult:
    passed: bool
    errors: tuple[str, ...]


def validate_crosswalk(
    *,
    upstream_scenario_ids: Iterable[str],
    upstream_mutants: Mapping[str, Iterable[str]],
) -> CrosswalkResult:
    errors: list[str] = []
    upstream_ids = tuple(upstream_scenario_ids)
    expected_ids = tuple(UPSTREAM_SCENARIO_TO_INTERNAL)
    if upstream_ids != expected_ids:
        errors.append(f"scenario ids changed: expected {expected_ids!r}, observed {upstream_ids!r}")

    internal_scenarios = tuple(UPSTREAM_SCENARIO_TO_INTERNAL[scenario] for scenario in expected_ids)
    if internal_scenarios != SCENARIO_IDS:
        errors.append(
            f"internal semantic scenario order drifted: expected {SCENARIO_IDS!r}, "
            f"observed {internal_scenarios!r}"
        )

    internal_mutants = {spec.id: spec for spec in ALL_MUTANTS}
    if set(upstream_mutants) != set(UPSTREAM_MUTANT_TO_INTERNAL):
        errors.append(
            "mutant ids changed: "
            f"expected {sorted(UPSTREAM_MUTANT_TO_INTERNAL)!r}, "
            f"observed {sorted(upstream_mutants)!r}"
        )

    for upstream_id, internal_id in UPSTREAM_MUTANT_TO_INTERNAL.items():
        if upstream_id not in upstream_mutants or internal_id not in internal_mutants:
            continue
        upstream_required_names = {
            UPSTREAM_SCENARIO_TO_INTERNAL[item] for item in upstream_mutants[upstream_id]
        }
        internal_required = set(internal_mutants[internal_id].must_fail)
        if upstream_id == "nop":
            # The internal NOP names every scenario and is expected to remain complete.
            if internal_required != set(SCENARIO_IDS):
                errors.append("internal nop mutant no longer fails every semantic scenario")
        elif not upstream_required_names.issubset(internal_required):
            errors.append(
                f"mutant {upstream_id} lost required upstream failures: "
                f"upstream={sorted(upstream_required_names)!r}, "
                f"internal={sorted(internal_required)!r}"
            )
    return CrosswalkResult(passed=not errors, errors=tuple(errors))
