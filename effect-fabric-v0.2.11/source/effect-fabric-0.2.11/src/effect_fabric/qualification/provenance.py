from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Iterable

PACKAGE_VERSION = "0.2.11"
INPUT_MANIFEST_NAME = "QUALIFICATION_INPUTS.sha256"
PROVENANCE_SCHEMA = "effect-fabric/qualification-provenance/v1"

GENERATED_ROOT_NAMES = {
    INPUT_MANIFEST_NAME,
    "MANIFEST.sha256",
    "release-manifest.json",
    "QUALIFICATION_RUN.json",
    "ARTIFACT_INTEGRITY_CHECK.json",
    "SOURCE_INTEGRITY_CHECK.json",
    "BUNDLE_MANIFEST.json",
    "INSTALLED_WHEEL_SMOKE.json",
    "INSTALLED_WHEEL_DEMO.json",
    "LOCAL_STATIC_SANITY.json",
    "BUILD_REPORT.md",
}
GENERATED_SUFFIXES = ("_QUALIFICATION.json", "_REPRODUCIBILITY.json")
EXCLUDED_PARTS = {
    ".git",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".release-stage",
    "__pycache__",
    "build",
    "dist",
    "release-artifacts",
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _is_generated_root_file(path: Path, root: Path) -> bool:
    rel = path.relative_to(root)
    return (
        len(rel.parts) == 1
        and (path.name in GENERATED_ROOT_NAMES or path.name.endswith(GENERATED_SUFFIXES))
    )


def included_input(path: Path, root: Path) -> bool:
    if not path.is_file() or path.suffix == ".pyc":
        return False
    rel = path.relative_to(root)
    if _is_generated_root_file(path, root):
        return False
    if path.name == ".qualification-core-tests.xml":
        return False
    return not any(part in EXCLUDED_PARTS or part.endswith(".egg-info") for part in rel.parts)


def qualification_input_files(root: Path) -> list[Path]:
    root = root.resolve()
    return sorted(path for path in root.rglob("*") if included_input(path, root))


def render_input_manifest(root: Path) -> str:
    root = root.resolve()
    lines = [
        f"{sha256_file(path)}  {path.relative_to(root).as_posix()}"
        for path in qualification_input_files(root)
    ]
    return "\n".join(lines) + "\n"


def qualification_inputs_sha256(root: Path) -> str:
    return hashlib.sha256(render_input_manifest(root).encode("utf-8")).hexdigest()


def write_input_manifest(root: Path) -> Path:
    root = root.resolve()
    target = root / INPUT_MANIFEST_NAME
    target.write_text(render_input_manifest(root), encoding="utf-8")
    return target


def validate_input_manifest(root: Path) -> list[str]:
    root = root.resolve()
    target = root / INPUT_MANIFEST_NAME
    if not target.is_file():
        return [f"missing:{INPUT_MANIFEST_NAME}"]
    expected = render_input_manifest(root)
    actual = target.read_text(encoding="utf-8")
    if actual != expected:
        return [f"stale:{INPUT_MANIFEST_NAME}"]
    return []


def current_provenance(root: Path) -> dict[str, str]:
    root = root.resolve()
    native = root / "bridges" / "durable-agent-outbox" / "effect_fabric_native_reduce.ts"
    donor_lock = root / "DONOR_LOCK.json"
    pyproject = root / "pyproject.toml"
    return {
        "schema": PROVENANCE_SCHEMA,
        "version": PACKAGE_VERSION,
        "qualification_inputs_sha256": qualification_inputs_sha256(root),
        "native_reducer_sha256": sha256_file(native) if native.is_file() else "MISSING",
        "donor_lock_sha256": sha256_file(donor_lock) if donor_lock.is_file() else "MISSING",
        "pyproject_sha256": sha256_file(pyproject) if pyproject.is_file() else "MISSING",
    }


def bind_document(document: dict[str, Any], root: Path) -> dict[str, Any]:
    bound = dict(document)
    bound["provenance"] = current_provenance(root)
    return bound


def provenance_failures(document: dict[str, Any], root: Path) -> list[str]:
    failures = validate_input_manifest(root)
    observed = document.get("provenance")
    expected = current_provenance(root)
    if not isinstance(observed, dict):
        failures.append("missing:provenance")
        return failures
    for key, value in expected.items():
        if observed.get(key) != value:
            failures.append(
                f"provenance:{key}:expected={value}:observed={observed.get(key)!r}"
            )
    return failures


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def write_bound_json(path: Path, document: dict[str, Any], root: Path) -> None:
    path.write_text(
        json.dumps(bind_document(document, root), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def bind_files(root: Path, paths: Iterable[Path]) -> list[str]:
    root = root.resolve()
    changed: list[str] = []
    for path in paths:
        candidate = path if path.is_absolute() else root / path
        if not candidate.is_file():
            continue
        document = load_json(candidate)
        write_bound_json(candidate, document, root)
        changed.append(candidate.relative_to(root).as_posix())
    return changed
