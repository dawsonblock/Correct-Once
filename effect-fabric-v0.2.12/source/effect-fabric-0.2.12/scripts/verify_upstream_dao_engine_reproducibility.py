#!/usr/bin/env python3
"""Prove the direct engine-interface report is stable across independent runs."""
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
        "--output",
        type=Path,
        default=Path("UPSTREAM_DAO_ENGINE_INTERFACE_REPRODUCIBILITY.json"),
    )
    args = parser.parse_args()

    hashes: list[str] = []
    with tempfile.TemporaryDirectory(prefix="ef-dao-engine-repro-") as temp_dir:
        for index in range(2):
            output = Path(temp_dir) / f"run{index}.json"
            subprocess.run(
                [
                    sys.executable,
                    "scripts/qualify_upstream_dao_engine.py",
                    "--donor-root",
                    str(args.donor_root),
                    "--output",
                    str(output),
                ],
                cwd=ROOT,
                check=True,
                text=True,
                capture_output=True,
            )
            hashes.append(digest(output))

    identical = hashes[0] == hashes[1]
    document = {
        "schema": "effect-fabric/upstream-dao-engine-interface-reproducibility/v1",
        "version": "0.2.12",
        "status": "PASS" if identical else "FAIL",
        "run_sha256": hashes,
        "identical": identical,
    }
    args.output.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n")
    print(json.dumps(document, indent=2, sort_keys=True))
    return 0 if identical else 1


if __name__ == "__main__":
    raise SystemExit(main())
