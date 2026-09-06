"""Map B CapabilitySideEffect → catalog tag + A MutationClass.

Verified against:
- B packages/capabilities/src/types.ts CapabilitySideEffect
- A effect_fabric/effect_registry.py MutationClass
- A effect_fabric/models.py ReversibilityClass
"""
from __future__ import annotations

from dataclasses import dataclass

# String literals keep this module importable without effect_fabric installed.
CATALOG_TAGS = frozenset({"read", "write", "destructive"})
B_SIDE_EFFECTS = frozenset({"read", "write", "external", "destructive", "unknown"})


@dataclass(frozen=True)
class ClassMapping:
    catalog_tag: str
    mutation_class: str  # MutationClass value
    reversibility: str | None  # ReversibilityClass value; None for read passthrough


_MAP: dict[str, ClassMapping] = {
    "read": ClassMapping("read", "read_only", None),
    "write": ClassMapping("write", "mutating", "unknown"),
    "external": ClassMapping("write", "mutating", "unknown"),
    "destructive": ClassMapping("destructive", "destructive", "irreversible"),
}


class SideEffectMappingError(ValueError):
    pass


def map_side_effect(side_effect: str) -> ClassMapping:
    if side_effect == "unknown" or side_effect not in _MAP:
        raise SideEffectMappingError(
            f"refuse registration for sideEffect={side_effect!r} (fail closed)"
        )
    return _MAP[side_effect]
