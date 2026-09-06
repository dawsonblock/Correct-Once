#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

from effect_fabric.qualification.provenance import bind_files, validate_input_manifest

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_REPORTS = [
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
    "STATIC_QUALIFICATION.json",
    "POSTGRES_QUALIFICATION.json",
    "QUALIFICATION_REPRODUCIBILITY.json",
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("paths", nargs="*")
    args = parser.parse_args()
    failures = validate_input_manifest(ROOT)
    if failures:
        print(json.dumps({"status": "FAIL", "failures": failures}, indent=2))
        return 1
    selected = [Path(item) for item in (args.paths or DEFAULT_REPORTS)]
    changed = bind_files(ROOT, selected)
    print(json.dumps({"status": "PASS", "bound": changed}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
