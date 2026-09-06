from __future__ import annotations

import argparse
import asyncio
import json

from .engine import EffectEngine
from .ledger import HashChainLedger
from .models import (
    ActionIntent,
    EffectContract,
    IdempotencyContract,
    Predicate,
    ReversibilityClass,
    ReversibilitySpec,
)
from .testing import FakeExecutor, FakeVerifier, FakeWorld


async def _demo() -> None:
    world = FakeWorld({"enabled": False, "version": 1})
    engine = EffectEngine()
    engine.register_executor(
        FakeExecutor(
            world,
            lambda state, intent: state.update(
                enabled=True,
                version=state["version"] + 1,
            ),
        )
    )
    engine.register_verifier(FakeVerifier(world))
    intent = ActionIntent(
        subject="demo-agent",
        operation="demo.enable",
        resource="demo://feature",
        arguments={},
    )
    contract = EffectContract(
        resource=intent.resource,
        expected=[Predicate(path="enabled", operator="eq", value=True)],
        verifier="fake-verifier",
    )
    tx = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=IdempotencyContract(
            mechanism="natural_resource",
            key="demo-enable",
        ),
        reversibility=ReversibilitySpec(classification=ReversibilityClass.UNKNOWN),
    )
    await engine.prepare(tx.transaction_id, "fake")
    capability = await engine.authorize(tx.transaction_id, "fake")
    await engine.execute(tx.transaction_id, capability)
    attestation = await engine.verify(tx.transaction_id)
    if not isinstance(engine.ledger, HashChainLedger):
        raise RuntimeError("demo requires the reference synchronous hash-chain ledger")
    print(
        json.dumps(
            {
                "transaction_id": tx.transaction_id,
                "verification": attestation.state,
                "ledger_root": engine.ledger.root,
            },
            default=str,
            indent=2,
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser(prog="effect-fabric")
    parser.add_argument("command", nargs="?", default="demo", choices=["demo"])
    parser.parse_args()
    asyncio.run(_demo())


if __name__ == "__main__":
    main()
