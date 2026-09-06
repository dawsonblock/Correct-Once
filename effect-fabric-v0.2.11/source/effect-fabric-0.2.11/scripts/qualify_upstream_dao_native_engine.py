#!/usr/bin/env python3
"""Run official DAO conformance through the v0.2.11 Effect Fabric native transition kernel."""
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
RUNNER = ROOT / "bridges" / "durable-agent-outbox" / "run_effect_fabric_native_engine.mjs"
NATIVE_REDUCER = ROOT / "bridges" / "durable-agent-outbox" / "effect_fabric_native_reduce.ts"


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


def make_native_worker(source: str) -> str:
    marker = "export class OutboxWorker"
    if source.count(marker) != 1:
        raise RuntimeError("locked donor worker source shape changed; refusing transformation")
    import_marker = 'from "./reduce.js";'
    if source.count(import_marker) != 1:
        raise RuntimeError("locked donor worker reduce import changed; refusing transformation")
    header = (
        "// Derived scheduling shell for Effect Fabric v0.2.11 (donor worker.ts is MIT).\n"
        "// Decision logic is redirected to the checked-in Effect Fabric native reducer.\n"
    )
    transformed = source.replace(import_marker, 'from "./effectFabricNativeReduce.js";', 1)
    transformed = transformed.replace(marker, "export class EffectFabricNativeScheduler", 1)
    return header + transformed


def poison_donor_reduce(compiled_reduce: Path) -> None:
    source = compiled_reduce.read_text()
    marker = "export function reduce(state, command, ctx) {"
    if marker not in source:
        raise RuntimeError("compiled donor reduce() shape changed; cannot install poison")
    source = source.replace(
        marker,
        marker + '\n    throw new Error("DONOR_REDUCE_POISONED_BY_EFFECT_FABRIC_V0_2_9");',
        1,
    )
    compiled_reduce.write_text(source)


def compile_locked_donor(donor: Path, temp: Path, tsc: str) -> dict[str, str]:
    core = donor / "packages" / "core"
    conformance = donor / "packages" / "conformance"
    packages = temp / "packages"
    packages.mkdir()
    shutil.copytree(core, packages / "core")
    shutil.copytree(conformance, packages / "conformance")
    shutil.copy2(donor / "tsconfig.base.json", temp / "tsconfig.base.json")

    worker_source = (core / "src" / "worker.ts").read_text()
    transformed = make_native_worker(worker_source)
    worker_path = packages / "core" / "src" / "effectFabricNativeWorker.ts"
    worker_path.write_text(transformed)
    shutil.copy2(NATIVE_REDUCER, packages / "core" / "src" / "effectFabricNativeReduce.ts")

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
    poison_donor_reduce(packages / "core" / "dist" / "reduce.js")
    return {
        "native_reducer_sha256": sha256(NATIVE_REDUCER),
        "derived_scheduler_sha256": hashlib.sha256(transformed.encode()).hexdigest(),
        "donor_reduce_poisoned_sha256": sha256(packages / "core" / "dist" / "reduce.js"),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--donor-root", type=Path, required=True)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("UPSTREAM_DAO_NATIVE_ENGINE_QUALIFICATION.json"),
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
        raise SystemExit("native engine qualification requires local tsc and node")

    with tempfile.TemporaryDirectory(prefix="effect-fabric-dao-native-") as temp_dir:
        temp = Path(temp_dir)
        build = compile_locked_donor(donor, temp, tsc)
        executed = run([node, str(RUNNER), str(temp), str(ROOT), sys.executable], ROOT)
        upstream = json.loads(executed.stdout)

    report = upstream["report"]
    native_calls = int(upstream.get("native_reducer_calls", 0))
    guard_checks = int(upstream.get("precommit_guard_checks", 0))
    shadow_observations = int(upstream.get("shadow_observations", 0))
    adapter = upstream["adapter"]
    passed = (
        not lock_errors
        and report["passed"]
        and native_calls > 0
        and guard_checks > 0
        and shadow_observations > 0
        and adapter.get("donor_reduce_poisoned") is True
        and adapter.get("donor_reduce_delegated") is False
    )
    document = {
        "schema": "effect-fabric/upstream-dao-native-engine-qualification/v1",
        "version": "0.2.11",
        "status": "PASS" if passed else "FAIL",
        "donor_source_lock": observed,
        "donor_source_lock_errors": lock_errors,
        "native_kernel": {
            "source": NATIVE_REDUCER.relative_to(ROOT).as_posix(),
            "license": "MIT-derived compatibility kernel",
            **build,
            "donor_reduce_poisoned": True,
            "donor_reduce_delegated": False,
        },
        "adapter": adapter,
        "native_reducer_calls": native_calls,
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
            "official ConformanceHarness -> EffectFabricNativeScheduler -> Effect Fabric native "
            "transition kernel -> EF pre-commit guard -> EF SQLite CAS store"
        ),
        "not_claimed": [
            (
                "the native compatibility kernel is not yet the production EffectEngine "
                "transaction model"
            ),
            "production PostgreSQL is not exercised by this SQLite qualification gate",
            "external provider calls are not transactionally atomic with local persistence",
            (
                "the native kernel is an MIT-derived compatibility implementation and remains "
                "subject to independent review"
            ),
        ],
    }
    args.output.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n")
    print(json.dumps(document, indent=2, sort_keys=True))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
