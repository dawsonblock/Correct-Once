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
VERSION = "0.2.12"
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


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


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


def wheel_source_mappings(root: Path) -> list[tuple[Path, str]]:
    mappings: list[tuple[Path, str]] = []

    package_root = root / "src"
    for path in sorted((package_root / "effect_fabric").rglob("*")):
        if not path.is_file() or path.suffix == ".pyc" or "__pycache__" in path.parts:
            continue
        mappings.append((path, path.relative_to(package_root).as_posix()))

    for path in sorted((root / "migrations").glob("*.sql")):
        mappings.append((path, f"share/effect-fabric/migrations/{path.name}"))

    bridge_root = root / "bridges" / "durable-agent-outbox"
    for pattern in ("*.mjs", "*.ts"):
        for path in sorted(bridge_root.glob(pattern)):
            mappings.append((path, f"share/effect-fabric/bridges/durable-agent-outbox/{path.name}"))

    mappings.append(
        (root / "THIRD_PARTY_NOTICES.md", "share/effect-fabric/licenses/THIRD_PARTY_NOTICES.md")
    )

    for path in sorted((root / "LICENSES").glob("*.txt")):
        mappings.append((path, f"share/effect-fabric/licenses/{path.name}"))

    for path in sorted((root / "spec").glob("*.json")):
        mappings.append((path, f"share/effect-fabric/spec/{path.name}"))

    return mappings


def verify_wheel_source_equivalence(root: Path, wheel: Path) -> dict[str, object]:
    with zipfile.ZipFile(wheel) as archive:
        names = archive.namelist()
        files: list[dict[str, object]] = []
        failures: list[str] = []
        for source_path, suffix in wheel_source_mappings(root):
            matches = [name for name in names if name.endswith(suffix)]
            entry: dict[str, object] = {
                "source": source_path.relative_to(root).as_posix(),
                "expected_wheel_suffix": suffix,
            }
            if len(matches) != 1:
                failures.append(f"wheel_entry:{suffix}:{len(matches)}")
                entry["status"] = "FAIL"
                entry["wheel_entry"] = matches
                files.append(entry)
                continue
            wheel_entry = matches[0]
            source_bytes = source_path.read_bytes()
            wheel_bytes = archive.read(wheel_entry)
            source_sha = sha256_bytes(source_bytes)
            wheel_sha = sha256_bytes(wheel_bytes)
            entry.update(
                {
                    "status": "PASS" if source_sha == wheel_sha else "FAIL",
                    "wheel_entry": wheel_entry,
                    "source_sha256": source_sha,
                    "wheel_sha256": wheel_sha,
                }
            )
            if source_sha != wheel_sha:
                failures.append(f"wheel_hash:{suffix}")
            files.append(entry)

    return {
        "schema": "effect-fabric/wheel-source-equivalence/v1",
        "version": VERSION,
        "status": "PASS" if not failures else "FAIL",
        "wheel": wheel.name,
        "source_manifest_sha256": sha256(root / "MANIFEST.sha256"),
        "compared_files": len(files),
        "failures": failures,
        "files": files,
    }


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
    source_equivalence = verify_wheel_source_equivalence(ROOT, wheels[0])
    source_equivalence_path = OUT / "WHEEL_SOURCE_EQUIVALENCE.json"
    source_equivalence_path.write_text(
        json.dumps(source_equivalence, indent=2, sort_keys=True) + "\n"
    )
    if source_equivalence["status"] != "PASS":
        raise RuntimeError(f"wheel/source equivalence failed: {source_equivalence['failures']}")

    artifacts = [source_tar, *wheels, wheel_check_path, source_equivalence_path]
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
        "wheel_source_equivalence_verified": True,
        "artifacts": entries,
    }
    (OUT / "artifact-manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n"
    )
    shutil.rmtree(STAGE, ignore_errors=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
