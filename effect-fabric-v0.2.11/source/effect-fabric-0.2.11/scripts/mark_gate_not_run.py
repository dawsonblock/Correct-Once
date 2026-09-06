#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

from effect_fabric.qualification.provenance import PACKAGE_VERSION, write_bound_json

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, action="append", required=True)
    parser.add_argument("--reason", required=True)
    parser.add_argument("--schema", default="effect-fabric/gate-result/v1")
    args = parser.parse_args()
    written: list[str] = []
    for output in args.output:
        document = {
            "schema": args.schema,
            "version": PACKAGE_VERSION,
            "status": "NOT_RUN",
            "reason": args.reason,
        }
        target = output if output.is_absolute() else ROOT / output
        write_bound_json(target, document, ROOT)
        written.append(target.name)
    print(json.dumps({"status": "PASS", "written": written}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
