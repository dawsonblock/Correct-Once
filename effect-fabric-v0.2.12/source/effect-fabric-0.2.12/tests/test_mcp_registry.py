import pytest

from effect_fabric.integrations.mcp_bridge import EffectDescriptor, EffectRegistry
from effect_fabric.models import (
    EffectContract,
    IdempotencyContract,
    ReversibilityClass,
    ReversibilitySpec,
)


def test_unknown_mutation_fails_closed():
    registry = EffectRegistry()
    with pytest.raises(PermissionError):
        registry.resolve_mutation("dangerous.delete")


def test_registered_mutation_resolves():
    registry = EffectRegistry()
    d = EffectDescriptor(
        operation="demo.set",
        executor="fake",
        contract_factory=lambda args: EffectContract(resource="r", verifier="v"),
        idempotency_factory=lambda args: IdempotencyContract(mechanism="natural_resource", key="k"),
        reversibility=ReversibilitySpec(classification=ReversibilityClass.UNKNOWN),
    )
    registry.register("demo.set", d)
    assert registry.resolve_mutation("demo.set") == d
