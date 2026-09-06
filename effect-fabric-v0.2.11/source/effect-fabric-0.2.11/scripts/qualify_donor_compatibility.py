#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

from effect_fabric.qualification.donor_conformance import run_internal_scenarios


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("DONOR_COMPATIBILITY_QUALIFICATION.json"),
    )
    args = parser.parse_args()
    results = run_internal_scenarios()
    internal_passed = all(r.passed for r in results)
    payload = {
        "schema": "effect-fabric/donor-compatibility-qualification/v1",
        "version": "0.2.11",
        "status": "PASS" if internal_passed else "FAIL",
        "all_passed": internal_passed,
        "upstream_suite_executed": False,
        "upstream_suite_status": "NOT_RUN",
        "internal_semantic_port": {
            "source": "durable-agent-outbox named conformance scenarios",
            "total": len(results),
            "passed": sum(r.passed for r in results),
            "all_passed": internal_passed,
            "results": [r.__dict__ for r in results],
        },
        "non_claim": (
            "This qualifies Effect Fabric's internal semantic port only; it does not claim that "
            "the upstream TypeScript conformance package executed against Effect Fabric."
        ),
    }
    args.output.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0 if payload["internal_semantic_port"]["all_passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
