#!/usr/bin/env python3
"""Verify active-path reproducibility against one independently recompiled second run.

The primary qualification must already exist. This script reruns the qualification once from the
locked donor source in a fresh temporary build and compares the complete stable JSON bytes. Thus the
pair consists of two independent donor compilations without requiring this script to perform two
additional expensive runs.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--donor-root", type=Path, required=True)
    parser.add_argument(
        "--primary",
        type=Path,
        default=Path("UPSTREAM_DAO_ACTIVE_ENGINE_QUALIFICATION.json"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("UPSTREAM_DAO_ACTIVE_ENGINE_REPRODUCIBILITY.json"),
    )
    args = parser.parse_args()

    primary = (ROOT / args.primary).resolve() if not args.primary.is_absolute() else args.primary
    if not primary.is_file():
        raise SystemExit(f"primary active qualification is missing: {primary}")

    with tempfile.TemporaryDirectory(prefix="ef-dao-active-repro-") as temp_dir:
        second = Path(temp_dir) / "second.json"
        subprocess.run(
            [
                sys.executable,
                "scripts/qualify_upstream_dao_active_engine.py",
                "--donor-root",
                str(args.donor_root),
                "--output",
                str(second),
            ],
            cwd=ROOT,
            check=True,
            text=True,
            capture_output=True,
        )
        hashes = [digest(primary), digest(second)]
        first_doc = json.loads(primary.read_text())
        second_doc = json.loads(second.read_text())
        identical = primary.read_bytes() == second.read_bytes()

    expected = {"total": 17, "passed": 17, "failed": 0}
    summaries = [first_doc["official_report"]["summary"], second_doc["official_report"]["summary"]]
    passed = identical and all(summary == expected for summary in summaries)
    document = {
        "schema": "effect-fabric/upstream-dao-active-engine-reproducibility/v1",
        "version": "0.2.11",
        "status": "PASS" if passed else "FAIL",
        "method": "primary qualification + one fresh independent donor compile/qualification",
        "run_sha256": hashes,
        "summaries": summaries,
        "identical": identical,
    }
    args.output.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n")
    print(json.dumps(document, indent=2, sort_keys=True))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
