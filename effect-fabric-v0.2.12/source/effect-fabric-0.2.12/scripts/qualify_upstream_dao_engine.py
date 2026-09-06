#!/usr/bin/env python3
"""Run the official DAO suite through Effect Fabric's structural OutboxEngine adapter."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / "bridges" / "durable-agent-outbox" / "run_effect_fabric_engine.mjs"


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


def run(command: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=cwd,
        check=True,
        text=True,
        capture_output=True,
    )


def compile_locked_donor(donor: Path, temp: Path, tsc: str) -> None:
    core = donor / "packages" / "core"
    conformance = donor / "packages" / "conformance"
    packages = temp / "packages"
    packages.mkdir()
    shutil.copytree(core, packages / "core")
    shutil.copytree(conformance, packages / "conformance")
    shutil.copy2(donor / "tsconfig.base.json", temp / "tsconfig.base.json")
    module_dir = temp / "node_modules" / "@durable-agent-outbox"
    module_dir.mkdir(parents=True)
    os.symlink("../../packages/core", module_dir / "core")
    shim = packages / "conformance" / "src" / "vitest-shim.d.ts"
    shim.write_text(
        'declare module "vitest" {\n'
        '  export const beforeAll: (...args: any[]) => any;\n'
        '  export const describe: (...args: any[]) => any;\n'
        '  export const expect: any;\n'
        '  export const it: (...args: any[]) => any;\n'
        '}\n'
    )
    run([tsc, "-p", "packages/core/tsconfig.json"], temp)
    run([tsc, "-p", "packages/conformance/tsconfig.json"], temp)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--donor-root", type=Path, required=True)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("UPSTREAM_DAO_ENGINE_INTERFACE_QUALIFICATION.json"),
    )
    args = parser.parse_args()

    donor = args.donor_root.resolve()
    core = donor / "packages" / "core"
    conformance = donor / "packages" / "conformance"
    lock = json.loads((ROOT / "DONOR_LOCK.json").read_text())
    bridge_lock = lock["donors"]["durable-agent-outbox"]["conformance_bridge"]
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
        raise SystemExit("direct engine qualification requires local tsc and node")

    with tempfile.TemporaryDirectory(prefix="effect-fabric-dao-engine-") as temp_dir:
        temp = Path(temp_dir)
        compile_locked_donor(donor, temp, tsc)
        executed = run(
            [node, str(RUNNER), str(temp), str(ROOT), sys.executable],
            ROOT,
        )
        upstream = json.loads(executed.stdout)

    report = upstream["report"]
    shadow_observations = int(upstream.get("shadow_observations", 0))
    passed = not lock_errors and report["passed"] and shadow_observations > 0
    document = {
        "schema": "effect-fabric/upstream-dao-engine-interface-qualification/v1",
        "version": "0.2.12",
        "status": "PASS" if passed else "FAIL",
        "donor_source_lock": observed,
        "donor_source_lock_errors": lock_errors,
        "adapter": upstream["adapter"],
        "shadow_observations": shadow_observations,
        "official_report": {
            "status": "PASS" if report["passed"] else "FAIL",
            "summary": report["summary"],
            "scenarios": [
                {
                    "id": row["id"],
                    "title": row["title"],
                    "passed": row["passed"],
                    "checks": len(row["checks"]),
                    **({"error": row["error"]} if row.get("error") else {}),
                }
                for row in report["scenarios"]
            ],
        },
        "qualified_boundary": (
            "official ConformanceHarness -> Effect Fabric structural OutboxEngine wrapper -> "
            "Effect Fabric SQLite store + independent execution-state invariant shadow"
        ),
        "not_claimed": [
            (
                "Effect Fabric active EffectEngine is not yet the implementation executing "
                "donor scheduling commands"
            ),
            "production PostgreSQL is not exercised by this SQLite qualification gate",
            "external provider calls are not transactionally atomic with local persistence",
        ],
    }
    args.output.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n")
    print(json.dumps(document, indent=2, sort_keys=True))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
