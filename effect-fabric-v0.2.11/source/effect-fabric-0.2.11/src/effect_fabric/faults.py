from __future__ import annotations

from dataclasses import dataclass, field


class SimulatedCrash(BaseException):
    """BaseException on purpose: ordinary engine Exception handlers must not reinterpret it."""


@dataclass
class FaultInjector:
    armed: set[str] = field(default_factory=set)
    hits: list[str] = field(default_factory=list)

    def hit(self, point: str) -> None:
        self.hits.append(point)
        if point in self.armed:
            raise SimulatedCrash(point)
