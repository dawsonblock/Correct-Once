#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from effect_fabric.qualification.provenance import (  # noqa: E402
    load_json,
    provenance_failures,
    qualification_inputs_sha256,
    sha256_file,
    validate_input_manifest,
)

EXCLUDED_NAMES = {"MANIFEST.sha256", "release-manifest.json", "QUALIFICATION_RUN.json"}
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


def included(path: Path, root: Path) -> bool:
    rel = path.relative_to(root)
    if path.name in EXCLUDED_NAMES or path.suffix == ".pyc":
        return False
    return not any(part in EXCLUDED_PARTS or part.endswith(".egg-info") for part in rel.parts)


def verify_source(root: Path) -> list[str]:
    failures: list[str] = []
    manifest = root / "MANIFEST.sha256"
    if not manifest.is_file():
        return ["missing:MANIFEST.sha256"]
    recorded: dict[str, str] = {}
    for raw in manifest.read_text(encoding="utf-8").splitlines():
        if not raw.strip():
            continue
        try:
            expected, rel = raw.split("  ", 1)
        except ValueError:
            failures.append(f"malformed_manifest_line:{raw}")
            continue
        recorded[rel] = expected
        path = root / rel
        if not path.is_file():
            failures.append(f"missing:{rel}")
        elif sha256_file(path) != expected:
            failures.append(f"hash:{rel}")

    actual = {
        path.relative_to(root).as_posix()
        for path in root.rglob("*")
        if path.is_file() and included(path, root)
    }
    for rel in sorted(actual - set(recorded)):
        failures.append(f"unmanifested:{rel}")
    for rel in sorted(set(recorded) - actual):
        failures.append(f"manifest_only:{rel}")
    return failures


def verify_qualification(root: Path) -> list[str]:
    failures = validate_input_manifest(root)
    release_path = root / "release-manifest.json"
    if not release_path.is_file():
        return failures + ["missing:release-manifest.json"]
    release = load_json(release_path)
    if release.get("qualification_inputs_sha256") != qualification_inputs_sha256(root):
        failures.append("release_manifest:qualification_inputs_sha256")
    source_manifest = root / "MANIFEST.sha256"
    if release.get("source_manifest_sha256") != sha256_file(source_manifest):
        failures.append("release_manifest:source_manifest_sha256")
    native = root / "bridges" / "durable-agent-outbox" / "effect_fabric_native_reduce.ts"
    if release.get("native_reducer_sha256") != sha256_file(native):
        failures.append("release_manifest:native_reducer_sha256")
    if release.get("donor_lock_sha256") != sha256_file(root / "DONOR_LOCK.json"):
        failures.append("release_manifest:donor_lock_sha256")

    report_hashes = release.get("qualification_report_sha256")
    if not isinstance(report_hashes, dict):
        failures.append("release_manifest:qualification_report_sha256")
        return failures
    for name, expected in report_hashes.items():
        path = root / name
        if not path.is_file():
            failures.append(f"qualification_missing:{name}")
            continue
        if sha256_file(path) != expected:
            failures.append(f"qualification_hash:{name}")
        try:
            document = load_json(path)
        except (OSError, ValueError, json.JSONDecodeError):
            failures.append(f"qualification_json:{name}")
            continue
        for failure in provenance_failures(document, root):
            failures.append(f"qualification_provenance:{name}:{failure}")
    return failures


def verify_artifacts(root: Path) -> list[str]:
    failures: list[str] = []
    manifest = root / "release-artifacts" / "artifact-manifest.json"
    if not manifest.exists():
        return failures
    document = json.loads(manifest.read_text(encoding="utf-8"))
    for item in document.get("artifacts", []):
        path = root / "release-artifacts" / item["path"]
        if not path.exists() or sha256_file(path) != item["sha256"]:
            failures.append(f"artifact:{item['path']}")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    root = args.root.resolve()
    failures = verify_source(root) + verify_qualification(root) + verify_artifacts(root)
    if failures:
        print(json.dumps({"status": "FAIL", "failures": failures}, indent=2))
        return 1
    print(json.dumps({"status": "PASS", "root": str(root)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
