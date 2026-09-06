"""Effect Fabric: governed, crash-aware external effects for autonomous agents."""

from .engine import EffectEngine
from .gateway import EffectDefinitionFactory, EffectGateway, EffectGatewayConfig, EffectRegistryV3
from .identity import WorkloadAuthority, WorkloadSigner, WorkloadVerifier
from .models import (
    ActionIntent,
    AttemptState,
    EffectContract,
    EffectTransaction,
    ExecutionState,
    IdempotencyContract,
    Predicate,
    RecoveryState,
    ReversibilityClass,
    ReversibilitySpec,
    VerificationState,
)

__all__ = [
    "ActionIntent",
    "AttemptState",
    "EffectContract",
    "EffectDefinitionFactory",
    "EffectEngine",
    "EffectGateway",
    "EffectGatewayConfig",
    "EffectRegistryV3",
    "EffectTransaction",
    "ExecutionState",
    "IdempotencyContract",
    "Predicate",
    "RecoveryState",
    "ReversibilityClass",
    "ReversibilitySpec",
    "VerificationState",
    "WorkloadAuthority",
    "WorkloadSigner",
    "WorkloadVerifier",
]

__version__ = "0.2.11"
