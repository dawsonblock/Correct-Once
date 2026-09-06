#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import tempfile
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from effect_fabric.anchors import (
    AnchorKeyring,
    AnchorSigner,
    FileAnchorStore,
    checkpoint_ledger,
    verify_anchor_chain,
    verify_ledger_against_anchor,
)
from effect_fabric.ledger import FileHashChainLedger, HashChainLedger

TX = "00000000-0000-0000-0000-000000000001"


def run() -> dict[str, object]:
    results: dict[str, bool] = {}
    with tempfile.TemporaryDirectory(prefix="effect-fabric-evidence-") as tmp:
        root = Path(tmp)
        ledger_path = root / "ledger" / "events.jsonl"
        anchor_path = root / "external" / "anchors.jsonl"
        ledger = FileHashChainLedger(ledger_path)
        ledger.append(TX, "effect.one", {"n": 1})
        ledger.append(TX, "effect.two", {"n": 2})
        original_root = ledger.root
        reopened = FileHashChainLedger(ledger_path)
        results["file_ledger_restart"] = reopened.verify() and reopened.root == original_root

        signer1 = AnchorSigner(key_id="q3")
        signer2 = AnchorSigner(key_id="q4")
        keyring = AnchorKeyring({"q3": signer1.public, "q4": signer2.public})
        store = FileAnchorStore(anchor_path)
        first = checkpoint_ledger(reopened, signer1, store)
        reopened.append(TX, "effect.three", {"n": 3})
        second = checkpoint_ledger(reopened, signer2, store)
        persisted = FileAnchorStore(anchor_path).load()
        results["anchor_restart"] = len(persisted) == 2
        results["anchor_chain"] = verify_anchor_chain(persisted, keyring)
        results["key_rotation"] = (
            second.previous_anchor_hash == first.anchor_hash and first.key_id != second.key_id
        )
        results["anchored_prefix_matches"] = verify_ledger_against_anchor(reopened, second)

        lines = ledger_path.read_bytes().splitlines(keepends=True)
        ledger_path.write_bytes(b"".join(lines[:-1]))
        truncated = FileHashChainLedger(ledger_path)
        results["suffix_deletion_detected"] = not verify_ledger_against_anchor(truncated, second)

        in_memory = HashChainLedger()
        in_memory.append(TX, "one")
        in_memory.append(TX, "two")
        original = in_memory._events[0]
        in_memory._events[0] = original.model_copy(update={"payload": {"tampered": True}})
        results["historical_tamper_detected"] = not in_memory.verify()

        try:
            keyring.add("q3", Ed25519PrivateKey.generate().public_key())
            results["key_id_rebind_rejected"] = False
        except ValueError:
            results["key_id_rebind_rejected"] = True

    passed = sum(results.values())
    total = len(results)
    output = {
        "schema": "effect-fabric/evidence-qualification/v1",
        "version": "0.2.11",
        "status": "PASS" if passed == total else "FAIL",
        "passed": passed,
        "total": total,
        "results": results,
        "claims": {
            "local_file_restart": True,
            "external_style_anchor_path": True,
            "key_rotation": True,
            "suffix_deletion_detection": True,
            "live_postgres_evidence": False,
            "worm_anchor": False,
        },
    }
    return output


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("EVIDENCE_QUALIFICATION.json"))
    args = parser.parse_args()
    output = run()
    args.output.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n")
    print(json.dumps(output, indent=2, sort_keys=True))
    return 0 if output["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
