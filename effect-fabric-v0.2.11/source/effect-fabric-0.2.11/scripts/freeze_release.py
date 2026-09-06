#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from effect_fabric.qualification.provenance import (  # noqa: E402
    PACKAGE_VERSION,
    load_json,
    provenance_failures,
    qualification_inputs_sha256,
    sha256_file,
    validate_input_manifest,
)

EXCLUDED_NAMES = {
    "MANIFEST.sha256",
    "release-manifest.json",
    "QUALIFICATION_RUN.json",
}
EXCLUDED_PARTS = {
    ".git",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".release-stage",
    "__pycache__",
    "build",
    "dist",
    "release-artifacts",
}

STABLE_QUALIFICATION = [
    "CORE_TEST_QUALIFICATION.json",
    "PROVIDER_QUALIFICATION.json",
    "EVIDENCE_QUALIFICATION.json",
    "TRANSACTIONAL_EVIDENCE_QUALIFICATION.json",
    "DONOR_COMPATIBILITY_QUALIFICATION.json",
    "TRANSITION_KERNEL_QUALIFICATION.json",
    "GATEWAY_QUALIFICATION.json",
    "WORKLOAD_IDENTITY_QUALIFICATION.json",
    "EXTERNAL_ANCHOR_QUALIFICATION.json",
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
    "REDUCER_EQUIVALENCE_QUALIFICATION.json",
    "REDUCER_NEGATIVE_CONTROL_QUALIFICATION.json",
    "STATIC_QUALIFICATION.json",
    "POSTGRES_QUALIFICATION.json",
    "QUALIFICATION_REPRODUCIBILITY.json",
    "RELEASE_QUALIFICATION.json",
]


def included(path: Path) -> bool:
    rel = path.relative_to(ROOT)
    if path.name in EXCLUDED_NAMES or path.suffix == ".pyc":
        return False
    return not any(part in EXCLUDED_PARTS or part.endswith(".egg-info") for part in rel.parts)


def digest(path: Path) -> str:
    return sha256_file(path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", default=PACKAGE_VERSION)
    args = parser.parse_args()
    if args.version != PACKAGE_VERSION:
        raise SystemExit(f"version mismatch: expected {PACKAGE_VERSION}, got {args.version}")

    input_failures = validate_input_manifest(ROOT)
    if input_failures:
        raise SystemExit("qualification input manifest is stale: " + ", ".join(input_failures))

    qualification_hashes: dict[str, str] = {}
    for name in STABLE_QUALIFICATION:
        path = ROOT / name
        if not path.exists():
            raise SystemExit(f"missing frozen qualification result: {name}")
        document = load_json(path)
        failures = provenance_failures(document, ROOT)
        if failures:
            raise SystemExit(f"unbound/stale qualification result {name}: {'; '.join(failures)}")
        qualification_hashes[name] = digest(path)

    qualification = load_json(ROOT / "RELEASE_QUALIFICATION.json")
    if qualification.get("overall") == "FAILED":
        raise SystemExit("refusing to freeze a FAILED release qualification")

    files = sorted(path for path in ROOT.rglob("*") if path.is_file() and included(path))
    lines = [f"{digest(path)}  {path.relative_to(ROOT).as_posix()}" for path in files]
    manifest = ROOT / "MANIFEST.sha256"
    manifest.write_text("\n".join(lines) + "\n", encoding="utf-8")

    release = {
        "schema": "effect-fabric/release-manifest/v3",
        "version": args.version,
        "release": "trust-boundary-hardening",
        "source_files": len(files),
        "qualification": qualification,
        "qualification_inputs_sha256": qualification_inputs_sha256(ROOT),
        "source_manifest_sha256": digest(manifest),
        "native_reducer_sha256": digest(
            ROOT / "bridges" / "durable-agent-outbox" / "effect_fabric_native_reduce.ts"
        ),
        "donor_lock_sha256": digest(ROOT / "DONOR_LOCK.json"),
        "qualification_report_sha256": qualification_hashes,
        "dynamic_run_metadata": "QUALIFICATION_RUN.json is excluded from the source manifest",
    }
    (ROOT / "release-manifest.json").write_text(
        json.dumps(release, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
