from __future__ import annotations

import asyncio

from effect_fabric.engine import EffectEngine
from effect_fabric.identity import WorkloadAuthority, WorkloadSigner, WorkloadVerifier
from effect_fabric.models import (
    ActionIntent,
    EffectContract,
    IdempotencyContract,
    ReversibilityClass,
    ReversibilitySpec,
)
from effect_fabric.testing import FakeExecutor, FakeWorld


async def main() -> None:
    authority = WorkloadAuthority(key_id="demo-authority")
    signer = WorkloadSigner.enroll(
        authority,
        worker_id="worker-1",
        subject="assistant",
        environment_id="demo",
        release_id="0.2.12",
    )
    engine = EffectEngine(
        workload_verifier=WorkloadVerifier.from_authority(authority),
        require_workload_identity=True,
        environment_id="demo",
        release_id="0.2.12",
    )
    world = FakeWorld({"enabled": False})
    engine.register_executor(FakeExecutor(world, lambda state, _intent: state.update(enabled=True)))
    intent = ActionIntent(subject="assistant", operation="demo.enable", resource="demo://feature")
    tx = await engine.propose(
        intent=intent,
        contract=EffectContract(resource=intent.resource, verifier="unused"),
        idempotency=IdempotencyContract(mechanism="natural_resource", key="demo:feature"),
        reversibility=ReversibilitySpec(classification=ReversibilityClass.UNKNOWN),
    )
    await engine.prepare(tx.transaction_id, "fake")
    cap = await engine.authorize(tx.transaction_id, "fake")
    result = await engine.execute(
        tx.transaction_id,
        cap,
        worker_id="worker-1",
        workload_signer=signer,
    )
    print(result.execution_state.value)


if __name__ == "__main__":
    asyncio.run(main())
