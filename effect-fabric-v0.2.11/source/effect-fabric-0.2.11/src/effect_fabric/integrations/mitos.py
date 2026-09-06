"""Counterfactual runtime boundary for Mitos-style snapshot/fork execution.

v0.1 deliberately contains no Mitos control-plane implementation. Counterfactual workers are
proposal generators only and MUST NOT receive production credentials or Effect Fabric capabilities.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol


@dataclass(frozen=True)
class CandidateResult:
    candidate_id: str
    artifact_ref: str
    score: float
    proposed_action: dict[str, Any] | None = None


class CounterfactualRuntime(Protocol):
    async def fork(self, snapshot_ref: str, count: int) -> list[str]: ...
    async def run_candidate(self, environment_ref: str, task: str) -> CandidateResult: ...
