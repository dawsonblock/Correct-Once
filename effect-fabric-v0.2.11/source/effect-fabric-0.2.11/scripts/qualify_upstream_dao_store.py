#!/usr/bin/env python3
"""Run the official durable-agent-outbox suite against Effect Fabric's SQLite store adapter."""
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
RUNNER = ROOT / "bridges" / "durable-agent-outbox" / "run_effect_fabric_store.mjs"


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
    parser.add_argument(
        "--output", type=Path, default=Path("UPSTREAM_DAO_DIRECT_STORE_QUALIFICATION.json")
    )
    args = parser.parse_args()
    donor = args.donor_root.resolve()
    core = donor / "packages" / "core"
    conformance = donor / "packages" / "conformance"
    if not core.is_dir() or not conformance.is_dir():
        raise SystemExit("donor root must contain packages/core and packages/conformance")

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
        raise SystemExit("direct store qualification requires local tsc and node")

    with tempfile.TemporaryDirectory(prefix="effect-fabric-dao-store-") as temp_dir:
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
        run([tsc, "-p", "packages/core/tsconfig.json"], cwd=temp)
        run([tsc, "-p", "packages/conformance/tsconfig.json"], cwd=temp)
        executed = run(
            [node, str(RUNNER), str(temp), str(ROOT), sys.executable],
            cwd=ROOT,
        )
        upstream = json.loads(executed.stdout)

    report = upstream["report"]
    status = "PASS" if not lock_errors and report["passed"] else "FAIL"
    document = {
        "schema": "effect-fabric/upstream-dao-direct-store-qualification/v1",
        "version": "0.2.11",
        "status": status,
        "donor_source_lock": observed,
        "donor_source_lock_errors": lock_errors,
        "adapter": upstream["adapter"],
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
            "official donor worker/reducer/tool/receipt source + Effect Fabric-owned SQLite "
            "OutboxStore compatibility adapter"
        ),
        "not_claimed": [
            "Effect Fabric active EffectEngine is not the donor OutboxEngine under this gate",
            (
                "Effect Fabric production PostgreSQL store is not exercised by this "
                "SQLite adapter gate"
            ),
            "external provider calls are not made transactionally with SQLite",
        ],
    }
    args.output.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n")
    print(json.dumps(document, indent=2, sort_keys=True))
    return 0 if status == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
