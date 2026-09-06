#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

from effect_fabric.qualification.reducer_mutants import run_negative_controls


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("REDUCER_NEGATIVE_CONTROL_QUALIFICATION.json"),
    )
    args = parser.parse_args()
    results = run_negative_controls()
    passed = all(
        not result.passed_suite
        and result.required_failures_observed
        and not result.crashed
        for result in results
    )
    payload = {
        "schema": "effect-fabric/reducer-negative-control-qualification/v1",
        "version": "0.2.11",
        "status": "PASS" if passed else "FAIL",
        "all_passed": passed,
        "mutation_score": {
            "killed": sum(
                result.required_failures_observed and not result.crashed
                for result in results
            ),
            "total": len(results),
        },
        "results": [result.__dict__ for result in results],
        "non_claim": (
            "These are Effect Fabric Python negative-control ports of the published donor bug "
            "families, not execution of the upstream TypeScript mutant implementations."
        ),
    }
    args.output.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
