from datetime import UTC, datetime, timedelta

import pytest
from cryptography.exceptions import InvalidSignature

from effect_fabric.capabilities import CapabilityAuthority
from effect_fabric.errors import (
    ActionDigestMismatch,
    CapabilityBindingMismatch,
    CapabilityExpired,
)


def issue(authority: CapabilityAuthority, **kwargs):
    defaults = {
        "transaction_id": "tx-1",
        "subject": "x",
        "action_digest": "abc",
        "executor": "e",
    }
    defaults.update(kwargs)
    return authority.issue(**defaults)


def test_capability_binds_exact_digest():
    authority = CapabilityAuthority()
    cap = issue(authority)
    authority.verify(cap, expected_digest="abc", expected_transaction_id="tx-1")
    with pytest.raises(ActionDigestMismatch):
        authority.verify(cap, expected_digest="def")


def test_capability_binds_transaction_identity():
    authority = CapabilityAuthority()
    cap = issue(authority)
    with pytest.raises(CapabilityBindingMismatch):
        authority.verify(
            cap,
            expected_digest="abc",
            expected_transaction_id="tx-2",
        )


def test_capability_expiry():
    authority = CapabilityAuthority()
    cap = issue(authority, ttl_seconds=1)
    with pytest.raises(CapabilityExpired):
        authority.verify(
            cap,
            expected_digest="abc",
            now=datetime.now(UTC) + timedelta(seconds=2),
        )


def test_signature_tampering_rejected():
    authority = CapabilityAuthority()
    cap = issue(authority)
    tampered = cap.model_copy(update={"policy_version": "evil"})
    with pytest.raises(InvalidSignature):
        authority.verify(tampered, expected_digest="abc")


def test_transaction_id_tampering_rejected_by_signature():
    authority = CapabilityAuthority()
    cap = issue(authority)
    tampered = cap.model_copy(update={"transaction_id": "tx-evil"})
    with pytest.raises(InvalidSignature):
        authority.verify(tampered, expected_digest="abc")
