from __future__ import annotations

from enum import StrEnum
from typing import Mapping

from pydantic import BaseModel, ConfigDict, Field


class GateStatus(StrEnum):
    PASS = "PASS"
    FAIL = "FAIL"
    NOT_RUN = "NOT_RUN"


class ReleaseQualification(BaseModel):
    """Machine-readable release qualification without inflating NOT_RUN into PASS."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: str = "effect-fabric/release-qualification/v1"
    version: str
    gates: dict[str, GateStatus] = Field(default_factory=dict)
    production_claim: bool = False

    @property
    def overall(self) -> str:
        if any(status == GateStatus.FAIL for status in self.gates.values()):
            return "FAILED"
        if any(status == GateStatus.NOT_RUN for status in self.gates.values()):
            return "REFERENCE_QUALIFIED"
        return "QUALIFIED"

    @classmethod
    def from_mapping(
        cls,
        *,
        version: str,
        gates: Mapping[str, GateStatus | str],
        production_claim: bool = False,
    ) -> "ReleaseQualification":
        normalized = {name: GateStatus(status) for name, status in gates.items()}
        return cls(version=version, gates=normalized, production_claim=production_claim)
