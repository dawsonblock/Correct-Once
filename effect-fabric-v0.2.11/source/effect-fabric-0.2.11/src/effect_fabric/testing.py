from __future__ import annotations

from collections.abc import Callable
from typing import Any
from dataclasses import dataclass

from .errors import AmbiguousEffectError
from .interfaces import EffectExecutor, EffectVerifier
from .models import (
    ActionIntent,
    EffectContract,
    ExecutionAttempt,
    Observation,
    PreparedEffect,
    ProviderReceipt,
    ReconciliationStatus,
)


@dataclass
class FakeWorld:
    state: dict[str, Any]
    effect_count: int = 0


class FakeExecutor(EffectExecutor):
    name = "fake"

    def __init__(
        self,
        world: FakeWorld,
        mutation: Callable[[dict[str, Any], ActionIntent], None],
        *,
        ambiguous_after_effect: bool = False,
    ):
        self.world = world
        self.mutation = mutation
        self.ambiguous_after_effect = ambiguous_after_effect
        self._attempt_effects: set[str] = set()

    async def prepare(
        self,
        intent: ActionIntent,
        contract: EffectContract,
    ) -> PreparedEffect:
        del intent, contract
        return PreparedEffect(
            observed_pre_state=dict(self.world.state),
            external_version=str(self.world.state.get("version", "0")),
        )

    async def execute(
        self,
        intent: ActionIntent,
        prepared: PreparedEffect,
        attempt: ExecutionAttempt,
    ) -> ProviderReceipt:
        del prepared
        if attempt.attempt_id not in self._attempt_effects:
            self.mutation(self.world.state, intent)
            self.world.effect_count += 1
            self._attempt_effects.add(attempt.attempt_id)
        if self.ambiguous_after_effect:
            raise AmbiguousEffectError("simulated lost response after external mutation")
        return ProviderReceipt(
            provider="fake",
            operation=intent.operation,
            external_id=attempt.attempt_id,
        )

    async def reconcile(
        self,
        intent: ActionIntent,
        prepared: PreparedEffect,
        attempt: ExecutionAttempt,
    ) -> ReconciliationStatus:
        del intent, prepared
        if attempt.attempt_id in self._attempt_effects:
            return ReconciliationStatus.HAPPENED
        return ReconciliationStatus.NOT_HAPPENED


class FakeVerifier(EffectVerifier):
    name = "fake-verifier"

    def __init__(self, world: FakeWorld, *, fail: bool = False):
        self.world = world
        self.fail = fail

    async def observe(
        self,
        intent: ActionIntent,
        contract: EffectContract,
    ) -> Observation:
        del contract
        if self.fail:
            raise RuntimeError("verifier unavailable")
        return Observation(
            verifier=self.name,
            resource=intent.resource,
            state=dict(self.world.state),
        )
