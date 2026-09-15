from __future__ import annotations

from .normalize import NormalizedMcpTool


DESTRUCTIVE_KEYWORDS = frozenset(
    {
        "delete",
        "destroy",
        "drop",
        "purge",
        "remove",
        "revoke",
        "wipe",
    }
)
MUTATING_KEYWORDS = frozenset(
    {
        "approve",
        "archive",
        "cancel",
        "create",
        "grant",
        "merge",
        "patch",
        "post",
        "put",
        "set",
        "sync",
        "update",
        "write",
    }
)
HIGH_RISK_KEYWORDS = frozenset(
    {
        "admin",
        "auth",
        "billing",
        "credential",
        "money",
        "payment",
        "permission",
        "policy",
        "production",
        "role",
        "secret",
        "settings",
        "token",
        "webhook",
    }
)


def _has_keyword(tool: NormalizedMcpTool, keywords: frozenset[str]) -> bool:
    text = tool.search_text
    return any(keyword in text for keyword in keywords)


def is_destructive(tool: NormalizedMcpTool) -> bool:
    if tool.annotations.read_only_hint is True and tool.verified_read_only:
        return False
    if tool.annotations.destructive_hint is True:
        return True
    return _has_keyword(tool, DESTRUCTIVE_KEYWORDS)


def is_mutating(tool: NormalizedMcpTool) -> bool:
    if tool.verified_read_only:
        return False
    if tool.annotations.read_only_hint is False:
        return True
    if tool.annotations.destructive_hint is True:
        return True
    return _has_keyword(tool, MUTATING_KEYWORDS) or is_destructive(tool)


def is_high_risk_mutation(tool: NormalizedMcpTool) -> bool:
    if not is_mutating(tool):
        return False
    return _has_keyword(tool, HIGH_RISK_KEYWORDS)
