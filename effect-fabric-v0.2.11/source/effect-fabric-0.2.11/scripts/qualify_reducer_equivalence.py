#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from effect_fabric.qualification.reducer_equivalence import run_runtime_equivalence


async def _run(output: Path) -> int:
    results = await run_runtime_equivalence()
    passed = all(result.passed for result in results)
    payload = {
        "schema": "effect-fabric/reducer-equivalence-qualification/v1",
        "version": "0.2.11",
        "status": "PASS" if passed else "FAIL",
        "all_passed": passed,
        "scope": (
            "common execution lifecycle shared by active EffectEngine "
            "and candidate pure reducer"
        ),
        "total": len(results),
        "passed": sum(result.passed for result in results),
        "results": [result.__dict__ for result in results],
        "not_covered": [
            (
                "withdrawal/supersession runtime equivalence "
                "(active runtime has no public command yet)"
            ),
            "live PostgreSQL multi-process equivalence",
            "actual upstream durable-agent-outbox TypeScript conformance adapter",
        ],
        "promotion_decision": (
            "KEEP_ACTIVE_ENGINE" if passed else "BLOCK_REDUCER_PROMOTION"
        ),
        "non_claim": (
            "Passing this gate proves equivalence only for the listed common in-memory semantic "
            "traces. It does not promote the reducer or replace database/provider qualification."
        ),
    }
    output.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0 if passed else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("REDUCER_EQUIVALENCE_QUALIFICATION.json"),
    )
    args = parser.parse_args()
    return asyncio.run(_run(args.output))


if __name__ == "__main__":
    raise SystemExit(main())
