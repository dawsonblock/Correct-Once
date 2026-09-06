#!/usr/bin/env python3
"""Compile and run the locked durable-agent-outbox conformance suite without network installs.

The donor packages are zero-runtime-dependency TypeScript. We copy the locked ``core`` and
``conformance`` packages to a temporary tree, compile them with the local ``tsc``, then invoke the
upstream public ``runConformance`` API and ``ALL_MUTANTS`` through a small Node runner. No donor
source is vendored into the Effect Fabric wheel or source distribution.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from effect_fabric.qualification.upstream_dao import validate_crosswalk

ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / "bridges" / "durable-agent-outbox" / "run_official.mjs"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def tree_digest(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        rel = path.relative_to(root).as_posix().encode()
        digest.update(len(rel).to_bytes(4, "big"))
        digest.update(rel)
        digest.update(bytes.fromhex(sha256(path)))
    return digest.hexdigest()


def run(command: list[str], *, cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, cwd=cwd, check=True, text=True, capture_output=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--donor-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("UPSTREAM_DAO_QUALIFICATION.json"))
    args = parser.parse_args()
    donor = args.donor_root.resolve()
    core = donor / "packages" / "core"
    conformance = donor / "packages" / "conformance"
    if not core.is_dir() or not conformance.is_dir():
        raise SystemExit("donor root must contain packages/core and packages/conformance")

    lock = json.loads((ROOT / "DONOR_LOCK.json").read_text())
    dao_lock = lock["donors"]["durable-agent-outbox"]
    bridge_lock = dao_lock.get("conformance_bridge", {})
    observed = {
        "core_tree_sha256": tree_digest(core),
        "conformance_tree_sha256": tree_digest(conformance),
        "core_package_json_sha256": sha256(core / "package.json"),
        "conformance_package_json_sha256": sha256(conformance / "package.json"),
    }
    lock_errors = [
        f"{name}: expected {bridge_lock.get(name)!r}, observed {value!r}"
        for name, value in observed.items()
        if bridge_lock.get(name) != value
    ]

    tsc = shutil.which("tsc")
    node = shutil.which("node")
    if tsc is None or node is None:
        raise SystemExit("upstream DAO qualification requires local tsc and node")

    with tempfile.TemporaryDirectory(prefix="effect-fabric-dao-") as temp_dir:
        temp = Path(temp_dir)
        packages = temp / "packages"
        packages.mkdir()
        shutil.copytree(core, packages / "core")
        shutil.copytree(conformance, packages / "conformance")
        shutil.copy2(donor / "tsconfig.base.json", temp / "tsconfig.base.json")
        module_dir = temp / "node_modules" / "@durable-agent-outbox"
        module_dir.mkdir(parents=True)
        os.symlink("../../packages/core", module_dir / "core")
        (packages / "conformance" / "src" / "vitest-shim.d.ts").write_text(
            'declare module "vitest" {\n'
            '  export const beforeAll: (...args: any[]) => any;\n'
            '  export const describe: (...args: any[]) => any;\n'
            '  export const expect: any;\n'
            '  export const it: (...args: any[]) => any;\n'
            '}\n'
        )
        core_compile = run([tsc, "-p", "packages/core/tsconfig.json"], cwd=temp)
        conformance_compile = run(
            [tsc, "-p", "packages/conformance/tsconfig.json"], cwd=temp
        )
        executed = run([node, str(RUNNER), str(temp)], cwd=ROOT)
        upstream = json.loads(executed.stdout)

    reference = upstream["reference"]
    mutant_rows = upstream["mutants"]
    scenario_ids = [row["id"] for row in upstream["scenarios"]]
    mutant_requirements = {row["id"]: row["must_fail"] for row in mutant_rows}
    crosswalk = validate_crosswalk(
        upstream_scenario_ids=scenario_ids,
        upstream_mutants=mutant_requirements,
    )
    mutants_pass = all(
        not row["passed_suite"] and row["required_failures_observed"] for row in mutant_rows
    )
    status = (
        "PASS"
        if not lock_errors and reference["passed"] and mutants_pass and crosswalk.passed
        else "FAIL"
    )
    document = {
        "schema": "effect-fabric/upstream-dao-qualification/v1",
        "version": "0.2.11",
        "status": status,
        "donor": {
            "name": "durable-agent-outbox",
            "core_package_version": json.loads((core / "package.json").read_text())["version"],
            "conformance_package_version": json.loads(
                (conformance / "package.json").read_text()
            )["version"],
            "source_lock": observed,
            "source_lock_errors": lock_errors,
        },
        "compiler": {
            "node": run([node, "--version"], cwd=ROOT).stdout.strip(),
            "tsc": run([tsc, "--version"], cwd=ROOT).stdout.strip(),
            "core_compile": "PASS" if core_compile.returncode == 0 else "FAIL",
            "conformance_compile": "PASS" if conformance_compile.returncode == 0 else "FAIL",
            "network_install_required": False,
        },
        "reference": {
            "status": "PASS" if reference["passed"] else "FAIL",
            "summary": reference["summary"],
            "scenarios": [
                {
                    "id": row["id"],
                    "title": row["title"],
                    "passed": row["passed"],
                    "checks": len(row["checks"]),
                }
                for row in reference["scenarios"]
            ],
        },
        "mutants": {
            "status": "PASS" if mutants_pass else "FAIL",
            "total": len(mutant_rows),
            "killed": sum(
                1
                for row in mutant_rows
                if not row["passed_suite"] and row["required_failures_observed"]
            ),
            "results": mutant_rows,
        },
        "crosswalk": {
            "status": "PASS" if crosswalk.passed else "FAIL",
            "errors": list(crosswalk.errors),
        },
        "effect_fabric_adapter_gates": {
            "direct_store_adapter": "see UPSTREAM_DAO_DIRECT_STORE_QUALIFICATION.json",
            "engine_interface_adapter": "see UPSTREAM_DAO_ENGINE_INTERFACE_QUALIFICATION.json",
            "active_scheduler_adapter": "see UPSTREAM_DAO_ACTIVE_ENGINE_QUALIFICATION.json",
            "transition_oracle_replacement": "NOT_RUN",
        },
    }
    args.output.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n")
    print(json.dumps(document, indent=2, sort_keys=True))
    return 0 if status == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
