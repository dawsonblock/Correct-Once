from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


def test_postgres_qualifier_emits_fresh_not_run_without_dsn(tmp_path):
    output = tmp_path / "postgres.json"
    env = dict(os.environ)
    env.pop("EFFECT_FABRIC_TEST_POSTGRES_DSN", None)
    completed = subprocess.run(
        [
            sys.executable,
            "scripts/qualify_postgres.py",
            "--allow-not-run",
            "--output",
            str(output),
        ],
        check=False,
        env={**env, "PYTHONPATH": str(Path("src").resolve())},
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0
    record = json.loads(output.read_text(encoding="utf-8"))
    assert record["schema"] == "effect-fabric/postgres-qualification/v2"
    assert record["version"] == "0.2.12"
    assert record["status"] == "NOT_RUN"
    assert record["live_database"] is False
    assert "sigkill_after_external_effect_before_receipt" in record["required_scenarios"]
    assert "migrations/006_postgres_fencing_claim_tokens.sql" in record["migrations"]


def test_release_aggregation_exposes_postgres_crash_fencing_gate():
    source = Path("scripts/generate_release_status.py").read_text(encoding="utf-8")
    assert '"postgres_crash_fencing": postgres_status' in source
