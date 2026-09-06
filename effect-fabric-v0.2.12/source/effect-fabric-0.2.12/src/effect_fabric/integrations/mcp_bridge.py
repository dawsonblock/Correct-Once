"""MCP-facing bridge contract.

This module intentionally does not import an MCP SDK. Hosts can adapt their SDK to these methods.
All mutating tools must resolve to a registered EffectDescriptor; unknown mutations fail closed.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from ..models import EffectContract, IdempotencyContract, ReversibilitySpec


@dataclass(frozen=True)
class EffectDescriptor:
    operation: str
    executor: str
    contract_factory: Callable[[dict[str, Any]], EffectContract]
    idempotency_factory: Callable[[dict[str, Any]], IdempotencyContract]
    reversibility: ReversibilitySpec


class EffectRegistry:
    def __init__(self):
        self._descriptors: dict[str, EffectDescriptor] = {}

    def register(self, tool_name: str, descriptor: EffectDescriptor) -> None:
        self._descriptors[tool_name] = descriptor

    def resolve_mutation(self, tool_name: str) -> EffectDescriptor:
        try:
            return self._descriptors[tool_name]
        except KeyError as exc:
            raise PermissionError(f"unregistered mutating MCP tool denied: {tool_name}") from exc
