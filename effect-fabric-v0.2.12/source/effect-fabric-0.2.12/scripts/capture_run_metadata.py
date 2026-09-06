#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path


def sha256(path: Path) -> str | None:
    if not path.exists():
        return None
    return hashlib.sha256(path.read_bytes()).hexdigest()


def command_output(command: list[str]) -> str | None:
    try:
        return subprocess.check_output(command, text=True, stderr=subprocess.DEVNULL).strip()
    except Exception:
        return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("QUALIFICATION_RUN.json"))
    parser.add_argument("--postgres-image-digest")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    record = {
        "schema": "effect-fabric/qualification-run/v1",
        "version": "0.2.12",
        "generated_at": datetime.now(UTC).isoformat(),
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "git_commit": command_output(["git", "rev-parse", "HEAD"]),
        "dependency_spec_hash": sha256(root / "pyproject.toml"),
        "dependency_lock_hash": sha256(root / "requirements-lock.txt"),
        "postgres_image_digest": args.postgres_image_digest or os.getenv(
            "EFFECT_FABRIC_POSTGRES_IMAGE_DIGEST"
        ),
    }
    args.output.write_text(json.dumps(record, indent=2, sort_keys=True) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
