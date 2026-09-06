#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path


def run_command(command: list[str]) -> tuple[str, int | None]:
    executable = shutil.which(command[0])
    if executable is None:
        return "NOT_RUN", None
    completed = subprocess.run(command, check=False)
    return ("PASS" if completed.returncode == 0 else "FAIL"), completed.returncode


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("STATIC_QUALIFICATION.json"))
    parser.add_argument("--allow-not-run", action="store_true")
    args = parser.parse_args()

    ruff, ruff_code = run_command(["ruff", "check", "."])
    mypy, mypy_code = run_command(["mypy", "src", "scripts"])
    record = {
        "schema": "effect-fabric/static-qualification/v1",
        "version": "0.2.12",
        "ruff": ruff,
        "mypy": mypy,
        "returncodes": {"ruff": ruff_code, "mypy": mypy_code},
    }
    args.output.write_text(json.dumps(record, indent=2, sort_keys=True) + "\n")
    print(json.dumps(record, indent=2, sort_keys=True))
    if "FAIL" in {ruff, mypy}:
        return 1
    if "NOT_RUN" in {ruff, mypy} and not args.allow_not_run:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
