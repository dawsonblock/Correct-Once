from datetime import UTC, datetime

import pytest

from effect_fabric.compat.agentaction import evidence_from_agentaction
from effect_fabric.external_authorization import ExternalDecision


def payload():
    return {
        "schema_version": "agentpass.action-authorization-evidence.v1",
        "profile": "https://profiles.example/mcp/v1",
        "issuer": "https://authz.example",
        "decision_id": "decision-1",
        "outcome": "ALLOW",
        "principal_id": "user:operator",
        "agent_id": "assistant",
        "runtime_id": "spiffe://example/ns/agents/assistant",
        "audience": "effect-fabric",
        "action_digest": "sha256:abc",
        "policy_hash": "sha256:policy",
        "approval_id": "approval-1",
        "issued_at": "2026-09-04T08:00:00Z",
        "expires_at": "2026-09-04T08:05:00Z",
        "tool": "provider.update",
    }


def test_agentaction_mapping_preserves_runtime_identity_and_binding():
    e = evidence_from_agentaction(payload())
    assert e.subject == "spiffe://example/ns/agents/assistant"
    assert e.decision is ExternalDecision.ALLOW
    e.validate_binding(
        subject=e.subject,
        action_digest="sha256:abc",
        now=datetime(2026, 9, 4, 8, 1, tzinfo=UTC),
    )


def test_agentaction_refer_is_not_execution_allow():
    p = payload()
    p["outcome"] = "REFER"
    e = evidence_from_agentaction(p)
    with pytest.raises(PermissionError):
        e.validate_binding(
            subject=e.subject,
            action_digest=e.action_digest,
            now=datetime(2026, 9, 4, 8, 1, tzinfo=UTC),
        )
