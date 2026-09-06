from datetime import UTC, datetime, timedelta

import pytest

from effect_fabric.external_authorization import ExternalAuthorizationEvidence, ExternalDecision


def evidence(**overrides):
    now = datetime(2026, 9, 4, tzinfo=UTC)
    data = dict(
        issuer="agentaction",
        decision=ExternalDecision.ALLOW,
        subject="agent-1",
        action_digest="sha256:abc",
        policy_version="policy-7",
        issued_at=now - timedelta(seconds=1),
        expires_at=now + timedelta(minutes=5),
        evidence_id="ev-1",
    )
    data.update(overrides)
    return ExternalAuthorizationEvidence(**data), now


def test_exact_action_binding_passes():
    e, now = evidence()
    e.validate_binding(subject="agent-1", action_digest="sha256:abc", now=now)


def test_action_substitution_rejected():
    e, now = evidence()
    with pytest.raises(PermissionError, match="action digest"):
        e.validate_binding(subject="agent-1", action_digest="sha256:evil", now=now)


def test_wrong_audience_rejected():
    e, now = evidence(audience="other-runtime")
    with pytest.raises(PermissionError, match="audience"):
        e.validate_binding(subject="agent-1", action_digest="sha256:abc", now=now)


def test_expired_evidence_rejected():
    e, now = evidence(expires_at=datetime(2026, 9, 3, tzinfo=UTC))
    with pytest.raises(PermissionError, match="expired"):
        e.validate_binding(subject="agent-1", action_digest="sha256:abc", now=now)
