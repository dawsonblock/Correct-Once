#!/usr/bin/env python3
"""Prove the direct-store upstream report is stable across two independent runs."""
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
        "--output", type=Path, default=Path("UPSTREAM_DAO_DIRECT_STORE_REPRODUCIBILITY.json")
    )
    args = parser.parse_args()
    hashes: list[str] = []
    with tempfile.TemporaryDirectory(prefix="effect-fabric-dao-store-repro-") as tmp:
        for index in range(2):
            target = Path(tmp) / f"run-{index}.json"
            subprocess.run(
                [
                    sys.executable,
                    "scripts/qualify_upstream_dao_store.py",
                    "--donor-root",
                    str(args.donor_root.resolve()),
                    "--output",
                    str(target),
                ],
                cwd=ROOT,
                check=True,
                stdout=subprocess.DEVNULL,
            )
            hashes.append(digest(target))
    status = "PASS" if len(set(hashes)) == 1 else "FAIL"
    document = {
        "schema": "effect-fabric/upstream-dao-direct-store-reproducibility/v1",
        "version": "0.2.12",
        "status": status,
        "run_sha256": hashes,
    }
    args.output.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n")
    print(json.dumps(document, indent=2, sort_keys=True))
    return 0 if status == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
