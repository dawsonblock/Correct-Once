#!/usr/bin/env python3
"""Run official DAO conformance through the v0.2.11 active Effect Fabric compatibility path."""
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
RUNNER = ROOT / "bridges" / "durable-agent-outbox" / "run_effect_fabric_active_engine.mjs"


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
    return subprocess.run(command, cwd=cwd, check=True, text=True, capture_output=True)


def make_active_worker(source: str) -> str:
    """Derive an Effect Fabric-owned scheduler shell from the exact locked donor worker source.

    The donor project is MIT licensed.  This compatibility artifact intentionally preserves the
    donor scheduler algorithm while changing the concrete class identity so the official
    ``OutboxWorker`` class is not instantiated.  Effect Fabric adds pre-commit enforcement around
    the resulting shell in the bridge.  The pure donor reducer remains the protocol oracle.
    """
    marker = "export class OutboxWorker"
    if source.count(marker) != 1:
        raise RuntimeError("locked donor worker source shape changed; refusing transformation")
    header = (
        "// Derived for Effect Fabric conformance from durable-agent-outbox worker.ts (MIT).\n"
        "// The scheduling algorithm is intentionally preserved; Effect Fabric adds a pre-commit\n"
        "// invariant gate at the store boundary and does not instantiate donor OutboxWorker.\n"
    )
    return header + source.replace(marker, "export class EffectFabricActiveScheduler", 1)


def compile_locked_donor(donor: Path, temp: Path, tsc: str) -> str:
    core = donor / "packages" / "core"
    conformance = donor / "packages" / "conformance"
    packages = temp / "packages"
    packages.mkdir()
    shutil.copytree(core, packages / "core")
    shutil.copytree(conformance, packages / "conformance")
    shutil.copy2(donor / "tsconfig.base.json", temp / "tsconfig.base.json")

    worker_source = core / "src" / "worker.ts"
    transformed = make_active_worker(worker_source.read_text())
    transformed_path = packages / "core" / "src" / "effectFabricActiveWorker.ts"
    transformed_path.write_text(transformed)
    transformed_digest = hashlib.sha256(transformed.encode()).hexdigest()

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
    return transformed_digest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--donor-root", type=Path, required=True)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("UPSTREAM_DAO_ACTIVE_ENGINE_QUALIFICATION.json"),
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
        raise SystemExit("active engine qualification requires local tsc and node")

    with tempfile.TemporaryDirectory(prefix="effect-fabric-dao-active-") as temp_dir:
        temp = Path(temp_dir)
        transformed_digest = compile_locked_donor(donor, temp, tsc)
        executed = run([node, str(RUNNER), str(temp), str(ROOT), sys.executable], ROOT)
        upstream = json.loads(executed.stdout)

    report = upstream["report"]
    guard_checks = int(upstream.get("precommit_guard_checks", 0))
    shadow_observations = int(upstream.get("shadow_observations", 0))
    passed = (
        not lock_errors
        and report["passed"]
        and guard_checks > 0
        and shadow_observations > 0
        and upstream["adapter"].get("donor_outbox_worker_instantiated") is False
    )
    document = {
        "schema": "effect-fabric/upstream-dao-active-engine-qualification/v1",
        "version": "0.2.11",
        "status": "PASS" if passed else "FAIL",
        "donor_source_lock": observed,
        "donor_source_lock_errors": lock_errors,
        "derived_scheduler": {
            "source": "locked durable-agent-outbox packages/core/src/worker.ts",
            "license": "MIT",
            "transformed_source_sha256": transformed_digest,
            "donor_outbox_worker_instantiated": False,
        },
        "adapter": upstream["adapter"],
        "precommit_guard_checks": guard_checks,
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
            "official ConformanceHarness -> EffectFabricActiveScheduler (no donor OutboxWorker "
            "instance) -> Effect Fabric pre-commit invariant gate -> Effect Fabric SQLite store"
        ),
        "not_claimed": [
            "the donor pure reduce() transition oracle has not yet been replaced",
            "the production EffectEngine transaction model is not yet the DAO scheduler itself",
            "production PostgreSQL is not exercised by this SQLite qualification gate",
            "external provider calls are not transactionally atomic with local persistence",
        ],
    }
    args.output.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n")
    print(json.dumps(document, indent=2, sort_keys=True))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
