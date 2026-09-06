#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

VERSION = "0.2.11"
SUITES = [
    "tests/test_postgres_integration.py",
    "tests/test_postgres_failure_matrix.py",
]
REQUIRED_SCENARIOS = [
    "parallel_capability_consumption_single_owner",
    "database_unique_active_attempt_guard",
    "orphan_takeover_increments_fence",
    "stale_attempt_cannot_finalize_with_new_epoch",
    "orphan_reconciliation_uses_current_transaction_fence",
    "outbox_claim_token_fences_reused_worker_id",
    "sigkill_after_started_commit",
    "sigkill_after_external_effect_before_receipt",
    "sigkill_after_receipt_commit",
    "sigkill_after_outbox_claim",
    "sigkill_after_ledger_append_before_ack",
    "outbox_redelivery_deduplicates_ledger_event",
]


def _junit_counts(path: Path) -> dict[str, int]:
    root = ET.parse(path).getroot()
    attrs = root.attrib
    if root.tag == "testsuite":
        suites = [root]
    else:
        suites = list(root.findall("testsuite"))
    def total(name: str) -> int:
        if name in attrs:
            return int(float(attrs.get(name, "0")))
        return sum(int(float(suite.attrib.get(name, "0"))) for suite in suites)
    return {
        "tests": total("tests"),
        "failures": total("failures"),
        "errors": total("errors"),
        "skipped": total("skipped"),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("POSTGRES_QUALIFICATION.json"))
    parser.add_argument("--allow-not-run", action="store_true")
    args = parser.parse_args()
    dsn = os.getenv("EFFECT_FABRIC_TEST_POSTGRES_DSN")
    migrations = [path.as_posix() for path in sorted(Path("migrations").glob("*.sql"))]
    base = {
        "schema": "effect-fabric/postgres-qualification/v2",
        "version": VERSION,
        "suites": SUITES,
        "migrations": migrations,
        "required_scenarios": REQUIRED_SCENARIOS,
        "crash_semantics": {
            "90": "reserved_pre_start_process_death",
            "91": "process_death_after_started_commit",
            "92": "process_death_after_ledger_append_before_outbox_ack",
            "93": "process_death_after_external_effect_before_receipt",
            "94": "process_death_after_receipt_commit",
            "95": "process_death_after_outbox_claim",
        },
    }
    if not dsn:
        record = {
            **base,
            "status": "NOT_RUN",
            "reason": "EFFECT_FABRIC_TEST_POSTGRES_DSN not set",
            "live_database": False,
        }
        args.output.write_text(json.dumps(record, indent=2, sort_keys=True) + "\n")
        print(json.dumps(record, indent=2, sort_keys=True))
        return 0 if args.allow_not_run else 2

    junit = Path(".qualification-postgres.xml")
    junit.unlink(missing_ok=True)
    completed = subprocess.run(
        [sys.executable, "-m", "pytest", *SUITES, "-ra", "-q", f"--junitxml={junit}"],
        text=True,
        capture_output=True,
        env=dict(os.environ),
        check=False,
    )
    counts = _junit_counts(junit) if junit.exists() else {
        "tests": 0,
        "failures": 0,
        "errors": 1,
        "skipped": 0,
    }
    junit.unlink(missing_ok=True)
    passed = (
        completed.returncode == 0
        and counts["tests"] > 0
        and counts["failures"] == 0
        and counts["errors"] == 0
        and counts["skipped"] == 0
    )
    record = {
        **base,
        "status": "PASS" if passed else "FAIL",
        "live_database": True,
        "returncode": completed.returncode,
        "junit": counts,
        "no_skipped_live_postgres_tests": counts["skipped"] == 0,
    }
    args.output.write_text(json.dumps(record, indent=2, sort_keys=True) + "\n")
    print(completed.stdout, end="")
    if completed.stderr:
        print(completed.stderr, file=sys.stderr, end="")
    print(json.dumps(record, indent=2, sort_keys=True))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
