from __future__ import annotations

from dataclasses import dataclass

from .classifier import ClassificationResult, classify_tool
from .descriptor_digest import descriptor_digest
from .normalize import NormalizedMcpTool


def _capability_id(tool: NormalizedMcpTool) -> str:
    return f"{tool.server}.{tool.name.replace('/', '.').replace(' ', '-')}"


@dataclass(frozen=True)
class AdmissionDecision:
    tool: NormalizedMcpTool
    classification: ClassificationResult
    descriptor_digest: str
    capability_id: str

    @property
    def admitted(self) -> bool:
        return self.classification.admitted


def admit_tool(tool: NormalizedMcpTool) -> AdmissionDecision:
    return AdmissionDecision(
        tool=tool,
        classification=classify_tool(tool),
        descriptor_digest=descriptor_digest(tool),
        capability_id=_capability_id(tool),
    )
