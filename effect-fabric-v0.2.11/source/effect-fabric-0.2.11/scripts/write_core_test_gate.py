#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import xml.etree.ElementTree as ET
from pathlib import Path

from effect_fabric.qualification.provenance import PACKAGE_VERSION, write_bound_json

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--junit", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("CORE_TEST_QUALIFICATION.json"))
    args = parser.parse_args()
    xml = ET.parse(args.junit).getroot()
    suites = [xml] if xml.tag == "testsuite" else list(xml.findall("testsuite"))
    counts = {
        key: sum(int(suite.attrib.get(key, "0")) for suite in suites)
        for key in ("tests", "failures", "errors", "skipped")
    }
    passed = counts["failures"] == 0 and counts["errors"] == 0
    document = {
        "schema": "effect-fabric/core-test-qualification/v1",
        "version": PACKAGE_VERSION,
        "status": "PASS" if passed else "FAIL",
        **counts,
    }
    target = args.output if args.output.is_absolute() else ROOT / args.output
    write_bound_json(target, document, ROOT)
    print(json.dumps(document, indent=2, sort_keys=True))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
