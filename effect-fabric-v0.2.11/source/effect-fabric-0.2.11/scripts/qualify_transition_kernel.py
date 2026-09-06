#!/usr/bin/env python3
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import subprocess
import sys
from pathlib import Path

from effect_fabric._generated_transition_table import COMMANDS, LEGAL_EDGES, SPEC_SHA256
from effect_fabric.dao_crosswalk import DAO_STATUS_CROSSWALK
from effect_fabric.models import ExecutionState
from effect_fabric.qualification.provenance import PACKAGE_VERSION

ROOT = Path(__file__).resolve().parents[1]


def source_write_offenders() -> list[str]:
    offenders: list[str] = []
    base = ROOT / "src/effect_fabric"
    for path in sorted(base.rglob("*.py")):
        if path.name == "transition_kernel.py":
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            targets: list[ast.expr] = []
            if isinstance(node, ast.Assign):
                targets = list(node.targets)
            elif isinstance(node, ast.AnnAssign):
                targets = [node.target]
            elif isinstance(node, ast.AugAssign):
                targets = [node.target]
            writes_state = any(
                isinstance(target, ast.Attribute) and target.attr == "execution_state"
                for target in targets
            )
            if writes_state:
                offenders.append(f"{path.relative_to(ROOT)}:{node.lineno}")
    return offenders


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("TRANSITION_KERNEL_QUALIFICATION.json"),
    )
    args = parser.parse_args()

    spec_path = ROOT / "spec/effect-transition-v1.json"
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    actual_sha = hashlib.sha256(spec_path.read_bytes()).hexdigest()
    generated = subprocess.run(
        [sys.executable, "scripts/generate_transition_tables.py", "--check"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    execution_states = {state.value for state in ExecutionState}
    spec_states = set(spec.get("states", {}))
    offenders = source_write_offenders()
    checks = {
        "generated_tables_current": generated.returncode == 0,
        "spec_hash_matches_generated": actual_sha == SPEC_SHA256,
        "runtime_state_coverage": spec_states == execution_states,
        "command_table_nonempty": bool(COMMANDS),
        "legal_edges_nonempty": bool(LEGAL_EDGES),
        "dao_crosswalk_locked": len(DAO_STATUS_CROSSWALK) == 12,
        "runtime_execution_state_writes_centralized": not offenders,
    }
    passed = all(checks.values())
    payload = {
        "schema": "effect-fabric/transition-kernel-qualification/v1",
        "version": PACKAGE_VERSION,
        "status": "PASS" if passed else "FAIL",
        "checks": checks,
        "transition_spec_sha256": actual_sha,
        "execution_states": sorted(execution_states),
        "commands": sorted(COMMANDS),
        "legal_edge_count": len(LEGAL_EDGES),
        "dao_crosswalk_status_count": len(DAO_STATUS_CROSSWALK),
        "direct_execution_state_write_offenders": offenders,
        "generated_table_check_stdout": generated.stdout.strip(),
        "generated_table_check_stderr": generated.stderr.strip(),
        "scope": (
            "structural execution-state algebra and runtime write centralization; "
            "not live provider/database qualification"
        ),
    }
    target = args.output if args.output.is_absolute() else ROOT / args.output
    target.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
