from __future__ import annotations

from dataclasses import dataclass

from .normalize import NormalizedMcpTool
from .risk_rules import is_destructive, is_high_risk_mutation, is_mutating


@dataclass(frozen=True)
class ClassificationResult:
    admitted: bool
    execution_class: str | None
    reason: str


def classify_tool(tool: NormalizedMcpTool) -> ClassificationResult:
    if tool.verified_read_only and (
        tool.annotations.destructive_hint is True or is_mutating(tool)
    ):
        return ClassificationResult(
            admitted=False,
            execution_class=None,
            reason="conflicting read-only and mutating evidence; review required",
        )

    if is_destructive(tool):
        return ClassificationResult(
            admitted=True,
            execution_class="critical",
            reason="destructive evidence requires CRITICAL admission",
        )

    if is_high_risk_mutation(tool):
        return ClassificationResult(
            admitted=True,
            execution_class="critical",
            reason="mutating high-risk evidence requires CRITICAL admission",
        )

    if is_mutating(tool):
        return ClassificationResult(
            admitted=True,
            execution_class="mutation",
            reason="mutating evidence maps to MUTATION admission",
        )

    if tool.verified_read_only:
        return ClassificationResult(
            admitted=True,
            execution_class="read",
            reason="verified read-only evidence maps to READ admission",
        )

    if tool.annotations.read_only_hint is True:
        return ClassificationResult(
            admitted=False,
            execution_class=None,
            reason="readOnlyHint is only evidence; independent read-only verification is still required",
        )

    return ClassificationResult(
        admitted=False,
        execution_class=None,
        reason="tool is unclassified and remains denied until review",
    )
