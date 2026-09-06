#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

from effect_fabric.qualification.provenance import qualification_inputs_sha256, write_input_manifest

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    target = write_input_manifest(ROOT)
    print(
        json.dumps(
            {
                "status": "PASS",
                "manifest": target.name,
                "qualification_inputs_sha256": qualification_inputs_sha256(ROOT),
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
