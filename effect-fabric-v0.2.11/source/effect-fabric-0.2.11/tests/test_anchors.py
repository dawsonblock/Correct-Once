import pytest
from cryptography.exceptions import InvalidSignature

from effect_fabric.anchors import AnchorSigner


def test_anchor_sign_and_verify():
    signer = AnchorSigner()
    anchor = signer.sign(sequence=3, ledger_root="abc")
    signer.verify(anchor)


def test_tampered_anchor_fails():
    signer = AnchorSigner()
    anchor = signer.sign(sequence=3, ledger_root="abc")
    tampered = anchor.model_copy(update={"ledger_root": "evil"})
    with pytest.raises((InvalidSignature, ValueError)):
        signer.verify(tampered)


def test_anchor_private_key_roundtrip():
    signer = AnchorSigner(key_id="persistent-key")
    restored = AnchorSigner.from_private_bytes(
        signer.private_key_bytes(),
        key_id="persistent-key",
    )
    anchor = restored.sign(sequence=1, ledger_root="root")
    signer.verify(anchor)


def test_anchor_binds_environment_and_release():
    from effect_fabric.anchors import AnchorKeyring

    signer = AnchorSigner(
        key_id="env-key",
        environment_id="prod-a",
        release_id="0.2.11",
    )
    anchor = signer.sign(sequence=1, ledger_root="root")
    keyring = AnchorKeyring({signer.key_id: signer.public})
    keyring.verify(
        anchor,
        expected_environment_id="prod-a",
        expected_release_id="0.2.11",
    )
    with pytest.raises(ValueError, match="environment"):
        keyring.verify(anchor, expected_environment_id="prod-b")


def test_directory_anchor_store_is_exclusive_and_chain_checked(tmp_path):
    from effect_fabric.anchors import DirectoryAnchorStore

    signer = AnchorSigner(environment_id="test", release_id="0.2.11")
    store = DirectoryAnchorStore(tmp_path / "anchors")
    first = signer.sign(sequence=1, ledger_root="r1")
    store.append(first)
    second = signer.sign(sequence=2, ledger_root="r2", previous_anchor_hash=first.anchor_hash)
    store.append(second)
    assert store.load() == [first, second]
    with pytest.raises(FileExistsError):
        store.append(second)
