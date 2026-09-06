#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import tempfile
from pathlib import Path

from effect_fabric.anchors import (
    AnchorKeyring,
    AnchorSigner,
    DirectoryAnchorStore,
    checkpoint_ledger,
    verify_anchor_chain,
    verify_ledger_against_anchor,
)
from effect_fabric.ledger import HashChainLedger
from effect_fabric.qualification.provenance import PACKAGE_VERSION


def run() -> dict[str, object]:
    ledger = HashChainLedger()
    ledger.append("tx-1", "effect.proposed", {"x": 1})
    ledger.append("tx-1", "effect.started", {"x": 2})
    signer = AnchorSigner(
        key_id="qualification-anchor-key",
        environment_id="qualification",
        release_id=PACKAGE_VERSION,
    )
    keyring = AnchorKeyring({signer.key_id: signer.public})
    with tempfile.TemporaryDirectory(prefix="effect-fabric-anchor-") as temp:
        store = DirectoryAnchorStore(Path(temp) / "independent-anchor-store")
        first = checkpoint_ledger(ledger, signer, store)
        ledger.append("tx-1", "effect.receipt_recorded", {"x": 3})
        second = checkpoint_ledger(ledger, signer, store)
        anchors = store.load()

        wrong_environment_rejected = False
        try:
            keyring.verify(first, expected_environment_id="another-environment")
        except Exception:
            wrong_environment_rejected = True

        tampered_anchor_rejected = False
        try:
            keyring.verify(first.model_copy(update={"ledger_root": "tampered"}))
        except Exception:
            tampered_anchor_rejected = True

        duplicate_append_rejected = False
        try:
            store.append(second)
        except Exception:
            duplicate_append_rejected = True

        checks = {
            "two_independent_checkpoints_persisted": len(anchors) == 2,
            "anchor_chain_valid": verify_anchor_chain(anchors, keyring),
            "first_prefix_still_verifies": verify_ledger_against_anchor(
                ledger, first
            ),
            "latest_root_verifies": verify_ledger_against_anchor(
                ledger, second
            ),
            "environment_binding_enforced": wrong_environment_rejected,
            "tampered_anchor_rejected": tampered_anchor_rejected,
            "duplicate_anchor_append_rejected": duplicate_append_rejected,
            "release_bound": all(anchor.release_id == PACKAGE_VERSION for anchor in anchors),
        }
    return {
        "schema": "effect-fabric/external-anchor-qualification/v1",
        "version": PACKAGE_VERSION,
        "status": "PASS" if all(checks.values()) else "FAIL",
        "checks": checks,
        "claim": (
            "Signed checkpoints can be persisted to an independently located "
            "append-only directory, chain/prefix verified, and bound to "
            "environment+release. This local qualification does not establish "
            "external WORM/Object-Lock semantics."
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("EXTERNAL_ANCHOR_QUALIFICATION.json"),
    )
    args = parser.parse_args()
    report = run()
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
