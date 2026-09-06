#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

from effect_fabric.qualification.provenance import (
    PACKAGE_VERSION,
    bind_document,
    load_json,
    provenance_failures,
)
from effect_fabric.qualification.release import GateStatus, ReleaseQualification

ROOT = Path(__file__).resolve().parents[1]


def status_from_file(path: Path) -> GateStatus:
    candidate = path if path.is_absolute() else ROOT / path
    if not candidate.exists():
        return GateStatus.NOT_RUN
    try:
        document = load_json(candidate)
    except (OSError, ValueError, json.JSONDecodeError):
        return GateStatus.FAIL
    if provenance_failures(document, ROOT):
        return GateStatus.FAIL
    explicit = document.get("status")
    if explicit in {status.value for status in GateStatus}:
        return GateStatus(explicit)
    passed = document.get("all_passed")
    if passed is None:
        return GateStatus.FAIL
    return GateStatus.PASS if passed else GateStatus.FAIL


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("RELEASE_QUALIFICATION.json"))
    parser.add_argument("--postgres", choices=[s.value for s in GateStatus])
    parser.add_argument("--ruff", choices=[s.value for s in GateStatus])
    parser.add_argument("--mypy", choices=[s.value for s in GateStatus])
    args = parser.parse_args()

    static_path = ROOT / "STATIC_QUALIFICATION.json"
    static = load_json(static_path) if static_path.exists() else {}
    static_bound = not provenance_failures(static, ROOT) if static else False
    postgres_path = ROOT / "POSTGRES_QUALIFICATION.json"
    postgres_status = (
        GateStatus(args.postgres)
        if args.postgres is not None
        else status_from_file(postgres_path)
    )
    ruff_status = (
        GateStatus(args.ruff)
        if args.ruff is not None
        else GateStatus(static.get("ruff", "NOT_RUN"))
        if static_bound
        else GateStatus.FAIL
        if static
        else GateStatus.NOT_RUN
    )
    mypy_status = (
        GateStatus(args.mypy)
        if args.mypy is not None
        else GateStatus(static.get("mypy", "NOT_RUN"))
        if static_bound
        else GateStatus.FAIL
        if static
        else GateStatus.NOT_RUN
    )

    record = ReleaseQualification.from_mapping(
        version=PACKAGE_VERSION,
        gates={
            "core_tests": status_from_file(Path("CORE_TEST_QUALIFICATION.json")),
            "provider_local": status_from_file(Path("PROVIDER_QUALIFICATION.json")),
            "evidence_local": status_from_file(Path("EVIDENCE_QUALIFICATION.json")),
            "transactional_evidence_local": status_from_file(
                Path("TRANSACTIONAL_EVIDENCE_QUALIFICATION.json")
            ),
            "donor_compatibility_internal": status_from_file(
                Path("DONOR_COMPATIBILITY_QUALIFICATION.json")
            ),
            "canonical_transition_kernel": status_from_file(
                Path("TRANSITION_KERNEL_QUALIFICATION.json")
            ),
            "effect_gateway_local": status_from_file(Path("GATEWAY_QUALIFICATION.json")),
            "workload_identity_local": status_from_file(
                Path("WORKLOAD_IDENTITY_QUALIFICATION.json")
            ),
            "external_anchor_local": status_from_file(
                Path("EXTERNAL_ANCHOR_QUALIFICATION.json")
            ),
            "reducer_equivalence_local": status_from_file(
                Path("REDUCER_EQUIVALENCE_QUALIFICATION.json")
            ),
            "reducer_negative_controls": status_from_file(
                Path("REDUCER_NEGATIVE_CONTROL_QUALIFICATION.json")
            ),
            "qualification_reproducibility_local": status_from_file(
                Path("QUALIFICATION_REPRODUCIBILITY.json")
            ),
            "upstream_dao_conformance": status_from_file(Path("UPSTREAM_DAO_QUALIFICATION.json")),
            "upstream_dao_reproducibility": status_from_file(
                Path("UPSTREAM_DAO_REPRODUCIBILITY.json")
            ),
            "upstream_dao_effect_fabric_store_adapter": status_from_file(
                Path("UPSTREAM_DAO_DIRECT_STORE_QUALIFICATION.json")
            ),
            "upstream_dao_effect_fabric_store_reproducibility": status_from_file(
                Path("UPSTREAM_DAO_DIRECT_STORE_REPRODUCIBILITY.json")
            ),
            "upstream_dao_effect_fabric_engine_interface_adapter": status_from_file(
                Path("UPSTREAM_DAO_ENGINE_INTERFACE_QUALIFICATION.json")
            ),
            "upstream_dao_effect_fabric_engine_interface_reproducibility": status_from_file(
                Path("UPSTREAM_DAO_ENGINE_INTERFACE_REPRODUCIBILITY.json")
            ),
            "upstream_dao_effect_fabric_active_engine_adapter": status_from_file(
                Path("UPSTREAM_DAO_ACTIVE_ENGINE_QUALIFICATION.json")
            ),
            "upstream_dao_effect_fabric_active_engine_reproducibility": status_from_file(
                Path("UPSTREAM_DAO_ACTIVE_ENGINE_REPRODUCIBILITY.json")
            ),
            "upstream_dao_effect_fabric_native_transition_kernel": status_from_file(
                Path("UPSTREAM_DAO_NATIVE_ENGINE_QUALIFICATION.json")
            ),
            "upstream_dao_effect_fabric_native_transition_reproducibility": status_from_file(
                Path("UPSTREAM_DAO_NATIVE_ENGINE_REPRODUCIBILITY.json")
            ),
            "upstream_dao_effect_fabric_transition_oracle_replacement": status_from_file(
                Path("UPSTREAM_DAO_NATIVE_ENGINE_QUALIFICATION.json")
            ),
            "production_effect_engine_native_kernel_promotion": GateStatus.NOT_RUN,
            "postgres_live": postgres_status,
            "postgres_crash_fencing": postgres_status,
            "ruff": ruff_status,
            "mypy": mypy_status,
            "github_live": GateStatus.NOT_RUN,
            "external_worm_anchor": GateStatus.NOT_RUN,
            "production_workload_identity": GateStatus.NOT_RUN,
        },
    )
    document = record.model_dump(mode="json")
    document["overall"] = record.overall
    document = bind_document(document, ROOT)
    target = args.output if args.output.is_absolute() else ROOT / args.output
    target.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(document, indent=2, sort_keys=True))
    return 1 if record.overall == "FAILED" else 0


if __name__ == "__main__":
    raise SystemExit(main())
