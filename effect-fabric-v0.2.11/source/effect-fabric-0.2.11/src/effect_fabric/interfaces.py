from __future__ import annotations

from abc import ABC, abstractmethod

from .models import (
    ActionIntent,
    EffectContract,
    ExecutionAttempt,
    Observation,
    PreparedEffect,
    ProviderReceipt,
    ReconciliationStatus,
)


class EffectExecutor(ABC):
    name: str

    @abstractmethod
    async def prepare(
        self,
        intent: ActionIntent,
        contract: EffectContract,
    ) -> PreparedEffect: ...

    @abstractmethod
    async def execute(
        self,
        intent: ActionIntent,
        prepared: PreparedEffect,
        attempt: ExecutionAttempt,
    ) -> ProviderReceipt: ...

    @abstractmethod
    async def reconcile(
        self,
        intent: ActionIntent,
        prepared: PreparedEffect,
        attempt: ExecutionAttempt,
    ) -> ReconciliationStatus: ...


class EffectVerifier(ABC):
    name: str

    @abstractmethod
    async def observe(
        self,
        intent: ActionIntent,
        contract: EffectContract,
    ) -> Observation: ...
