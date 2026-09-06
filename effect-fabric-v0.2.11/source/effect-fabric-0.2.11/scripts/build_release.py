"""Build reproducible-ish clean source and wheel artifacts from a frozen release tree.

Stable qualification outputs must be generated before this script. Timestamped run metadata is
copied beside the artifacts but is intentionally excluded from the source distribution and source
hash manifest.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = "0.2.11"
OUT = ROOT / "release-artifacts"
STAGE = ROOT / ".release-stage"
SOURCE_DATE_EPOCH = 946684800  # 2000-01-01, safely representable by ZIP/wheel formats.
EXCLUDES = {
    ".git",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".release-stage",
    "build",
    "dist",
    "release-artifacts",
    "QUALIFICATION_RUN.json",
}


def ignored(_directory: str, names: list[str]) -> set[str]:
    return {
        name
        for name in names
        if name in EXCLUDES
        or name == "__pycache__"
        or name.endswith(".egg-info")
        or name.endswith(".pyc")
    }


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_tar(info: tarfile.TarInfo) -> tarfile.TarInfo:
    info.uid = 0
    info.gid = 0
    info.uname = "root"
    info.gname = "root"
    info.mtime = SOURCE_DATE_EPOCH
    return info


def build_source_tar(source_root: Path, target: Path) -> None:
    with target.open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=SOURCE_DATE_EPOCH) as gz:
            with tarfile.open(fileobj=gz, mode="w") as archive:
                archive.add(source_root, arcname=source_root.name, filter=normalize_tar)



def verify_wheel_contents(wheel: Path) -> dict[str, object]:
    required_suffixes = [
        "share/effect-fabric/migrations/001_core.sql",
        "share/effect-fabric/migrations/006_postgres_fencing_claim_tokens.sql",
        "share/effect-fabric/migrations/007_workload_identity.sql",
        "share/effect-fabric/bridges/durable-agent-outbox/effect_fabric_native_reduce.ts",
        "share/effect-fabric/bridges/durable-agent-outbox/generated_transition_table.ts",
        "share/effect-fabric/spec/effect-transition-v1.json",
        "share/effect-fabric/bridges/durable-agent-outbox/run_effect_fabric_native_engine.mjs",
        "share/effect-fabric/licenses/THIRD_PARTY_NOTICES.md",
        "share/effect-fabric/licenses/durable-agent-outbox-MIT.txt",
    ]
    with zipfile.ZipFile(wheel) as archive:
        names = archive.namelist()
    matches: dict[str, str | None] = {}
    for suffix in required_suffixes:
        matches[suffix] = next((name for name in names if name.endswith(suffix)), None)
    missing = [suffix for suffix, match in matches.items() if match is None]
    return {
        "schema": "effect-fabric/wheel-contents-check/v1",
        "version": VERSION,
        "status": "PASS" if not missing else "FAIL",
        "wheel": wheel.name,
        "required": matches,
        "missing": missing,
    }


def main() -> int:
    subprocess.run([sys.executable, "scripts/verify_release_integrity.py"], cwd=ROOT, check=True)
    shutil.rmtree(OUT, ignore_errors=True)
    shutil.rmtree(STAGE, ignore_errors=True)
    OUT.mkdir()
    source_root = STAGE / f"effect-fabric-{VERSION}"
    shutil.copytree(ROOT, source_root, ignore=ignored)

    source_tar = OUT / f"effect-fabric-{VERSION}.tar.gz"
    build_source_tar(source_root, source_tar)

    wheel_dir = OUT / "wheel"
    wheel_dir.mkdir()
    env = dict(os.environ)
    env["SOURCE_DATE_EPOCH"] = str(SOURCE_DATE_EPOCH)
    subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "wheel",
            str(source_root),
            "--no-deps",
            "--no-build-isolation",
            "--wheel-dir",
            str(wheel_dir),
        ],
        check=True,
        env=env,
    )

    wheels = sorted(wheel_dir.glob("*.whl"))
    if len(wheels) != 1:
        raise RuntimeError(f"expected exactly one wheel, found {len(wheels)}")
    wheel_check = verify_wheel_contents(wheels[0])
    wheel_check_path = OUT / "WHEEL_CONTENTS_CHECK.json"
    wheel_check_path.write_text(json.dumps(wheel_check, indent=2, sort_keys=True) + "\n")
    if wheel_check["status"] != "PASS":
        raise RuntimeError(f"wheel is incomplete: {wheel_check['missing']}")

    artifacts = [source_tar, *wheels, wheel_check_path]
    run_metadata = ROOT / "QUALIFICATION_RUN.json"
    if run_metadata.exists():
        copied = OUT / "QUALIFICATION_RUN.json"
        shutil.copy2(run_metadata, copied)
        artifacts.append(copied)

    entries = []
    for path in artifacts:
        rel = path.relative_to(OUT).as_posix()
        entries.append(
            {"path": rel, "bytes": path.stat().st_size, "sha256": sha256(path)}
        )
    manifest = {
        "schema": "effect-fabric/artifact-manifest/v3",
        "version": VERSION,
        "source_date_epoch": SOURCE_DATE_EPOCH,
        "wheel_contents_verified": True,
        "artifacts": entries,
    }
    (OUT / "artifact-manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n"
    )
    shutil.rmtree(STAGE, ignore_errors=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
