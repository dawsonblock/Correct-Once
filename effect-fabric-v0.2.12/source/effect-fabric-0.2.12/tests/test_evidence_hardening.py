import json
from pathlib import Path

import pytest
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


def test_file_ledger_survives_restart(tmp_path: Path):
    path = tmp_path / "ledger.jsonl"
    ledger = FileHashChainLedger(path)
    ledger.append("00000000-0000-0000-0000-000000000001", "effect.one", {"n": 1})
    ledger.append("00000000-0000-0000-0000-000000000001", "effect.two", {"n": 2})
    root = ledger.root

    reopened = FileHashChainLedger(path)
    assert reopened.verify()
    assert reopened.count == 2
    assert reopened.root == root


def test_file_ledger_rejects_historical_tamper_on_restart(tmp_path: Path):
    path = tmp_path / "ledger.jsonl"
    ledger = FileHashChainLedger(path)
    ledger.append("00000000-0000-0000-0000-000000000001", "effect.one", {"n": 1})
    ledger.append("00000000-0000-0000-0000-000000000001", "effect.two", {"n": 2})

    lines = path.read_text().splitlines()
    document = json.loads(lines[0])
    document["payload"] = {"n": 999}
    lines[0] = json.dumps(document, separators=(",", ":"))
    path.write_text("\n".join(lines) + "\n")

    with pytest.raises(ValueError, match="integrity verification failed"):
        FileHashChainLedger(path)


def test_external_anchor_detects_ledger_suffix_deletion(tmp_path: Path):
    ledger_path = tmp_path / "ledger" / "events.jsonl"
    anchor_path = tmp_path / "external-anchor" / "anchors.jsonl"
    ledger = FileHashChainLedger(ledger_path)
    for index in range(3):
        ledger.append(
            "00000000-0000-0000-0000-000000000001",
            f"effect.{index}",
            {"n": index},
        )
    signer = AnchorSigner(key_id="k1")
    store = FileAnchorStore(anchor_path)
    anchor = checkpoint_ledger(ledger, signer, store)
    assert verify_ledger_against_anchor(ledger, anchor)

    # Simulate an attacker deleting the latest valid event while leaving the external anchor.
    lines = ledger_path.read_bytes().splitlines(keepends=True)
    ledger_path.write_bytes(b"".join(lines[:-1]))
    truncated = FileHashChainLedger(ledger_path)
    assert truncated.verify()
    assert not verify_ledger_against_anchor(truncated, anchor)


def test_anchor_store_survives_restart_and_chain_verifies(tmp_path: Path):
    ledger = HashChainLedger()
    ledger.append("00000000-0000-0000-0000-000000000001", "one")
    signer = AnchorSigner(key_id="k1")
    keyring = AnchorKeyring({"k1": signer.public})
    path = tmp_path / "external" / "anchors.jsonl"
    store = FileAnchorStore(path)
    first = checkpoint_ledger(ledger, signer, store)
    ledger.append("00000000-0000-0000-0000-000000000001", "two")
    second = checkpoint_ledger(ledger, signer, store)

    reopened = FileAnchorStore(path)
    anchors = reopened.load()
    assert [item.anchor_id for item in anchors] == [first.anchor_id, second.anchor_id]
    assert verify_anchor_chain(anchors, keyring)


def test_anchor_key_rotation_preserves_old_proof(tmp_path: Path):
    ledger = HashChainLedger()
    store = FileAnchorStore(tmp_path / "anchors.jsonl")
    old_signer = AnchorSigner(key_id="2026-q3")
    new_signer = AnchorSigner(key_id="2026-q4")
    keyring = AnchorKeyring()
    keyring.add(old_signer.key_id, old_signer.public)
    keyring.add(new_signer.key_id, new_signer.public)

    ledger.append("00000000-0000-0000-0000-000000000001", "one")
    first = checkpoint_ledger(ledger, old_signer, store)
    ledger.append("00000000-0000-0000-0000-000000000001", "two")
    second = checkpoint_ledger(ledger, new_signer, store)

    anchors = store.load()
    assert first.key_id != second.key_id
    assert second.previous_anchor_hash == first.anchor_hash
    assert verify_anchor_chain(anchors, keyring)


def test_key_id_cannot_be_rebound_to_different_public_key():
    signer = AnchorSigner(key_id="stable-id")
    keyring = AnchorKeyring({signer.key_id: signer.public})
    with pytest.raises(ValueError, match="already maps"):
        keyring.add("stable-id", Ed25519PrivateKey.generate().public_key())


def test_anchor_chain_detects_middle_anchor_removal(tmp_path: Path):
    ledger = HashChainLedger()
    signer = AnchorSigner(key_id="k1")
    keyring = AnchorKeyring({"k1": signer.public})
    store = FileAnchorStore(tmp_path / "anchors.jsonl")
    anchors = []
    for index in range(3):
        ledger.append("00000000-0000-0000-0000-000000000001", f"e{index}")
        anchors.append(checkpoint_ledger(ledger, signer, store))
    assert verify_anchor_chain(anchors, keyring)
    assert not verify_anchor_chain([anchors[0], anchors[2]], keyring)


def test_anchor_signature_tamper_fails_chain(tmp_path: Path):
    ledger = HashChainLedger()
    ledger.append("00000000-0000-0000-0000-000000000001", "one")
    signer = AnchorSigner(key_id="k1")
    keyring = AnchorKeyring({"k1": signer.public})
    anchor = checkpoint_ledger(ledger, signer, FileAnchorStore(tmp_path / "anchors.jsonl"))
    tampered = anchor.model_copy(update={"ledger_root": "00" * 32})
    assert not verify_anchor_chain([tampered], keyring)
