import pytest

from effect_fabric.engine import EffectEngine
from effect_fabric.models import (
    ActionIntent,
    EffectContract,
    IdempotencyContract,
    Predicate,
    ReversibilityClass,
    ReversibilitySpec,
)
from effect_fabric.testing import FakeExecutor, FakeVerifier, FakeWorld


@pytest.fixture
def basic():
    world = FakeWorld({"enabled": False, "version": 1, "labels": []})

    def mutation(state, intent):
        state["enabled"] = True
        state["version"] += 1

    engine = EffectEngine()
    engine.register_executor(FakeExecutor(world, mutation))
    engine.register_verifier(FakeVerifier(world))
    intent = ActionIntent(
        subject="agent-a",
        operation="demo.enable",
        resource="demo://feature",
        arguments={"mode": "safe"},
    )
    contract = EffectContract(
        resource=intent.resource,
        preconditions=[Predicate(path="enabled", operator="eq", value=False)],
        expected=[Predicate(path="enabled", operator="eq", value=True)],
        verifier="fake-verifier",
    )
    idem = IdempotencyContract(mechanism="natural_resource", key="demo:enable:feature")
    rev = ReversibilitySpec(classification=ReversibilityClass.UNKNOWN)
    return engine, world, intent, contract, idem, rev
