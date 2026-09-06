"""AgentAction / AgentPass exact-action evidence compatibility."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from ..external_authorization import ExternalAuthorizationEvidence, ExternalDecision


def _dt(value: Any) -> datetime:
    if not isinstance(value, str):
        raise ValueError("authorization timestamp must be an ISO-8601 string")
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def evidence_from_agentaction(payload: dict[str, Any]) -> ExternalAuthorizationEvidence:
    """Map AgentAction's experimental MCP authorization evidence into EF's neutral envelope.

    Signature/JWS validation stays outside this mapper.  Callers must verify the upstream envelope
    first and only then construct/use the returned evidence object.
    """
    outcome = str(payload.get("outcome", "")).upper()
    decisions = {
        "ALLOW": ExternalDecision.ALLOW,
        "REFER": ExternalDecision.REQUIRE_APPROVAL,
        "DENY": ExternalDecision.DENY,
    }
    try:
        decision = decisions[outcome]
    except KeyError as exc:
        raise ValueError(f"unsupported AgentAction outcome: {outcome!r}") from exc
    subject = payload.get("runtime_id") or payload.get("agent_id") or payload.get("principal_id")
    if not isinstance(subject, str) or not subject:
        raise ValueError("AgentAction evidence missing runtime/agent/principal identity")
    action_digest = payload.get("action_digest")
    if not isinstance(action_digest, str) or not action_digest:
        raise ValueError("AgentAction evidence missing action_digest")
    issuer = payload.get("issuer")
    audience = payload.get("audience")
    evidence_id = payload.get("decision_id") or payload.get("evidence_id")
    if not all(isinstance(v, str) and v for v in (issuer, audience, evidence_id)):
        raise ValueError("AgentAction evidence missing issuer/audience/decision id")
    policy_version = payload.get("policy_hash") or payload.get("policy_id") or "unknown"
    approval = payload.get("approval_evidence_ref") or payload.get("approval_id")
    return ExternalAuthorizationEvidence(
        issuer=issuer,
        decision=decision,
        subject=subject,
        action_digest=action_digest,
        policy_version=str(policy_version),
        issued_at=_dt(payload.get("issued_at")),
        expires_at=_dt(payload.get("expires_at")),
        audience=audience,
        approval_digest=str(approval) if approval is not None else None,
        evidence_id=evidence_id,
        signature_profile=str(payload.get("profile")) if payload.get("profile") else None,
        claims={
            key: value
            for key, value in payload.items()
            if key not in {
                "issuer", "outcome", "action_digest", "policy_hash", "policy_id", "issued_at",
                "expires_at", "audience", "decision_id", "evidence_id", "approval_evidence_ref",
                "approval_id", "profile",
            }
        },
    )
