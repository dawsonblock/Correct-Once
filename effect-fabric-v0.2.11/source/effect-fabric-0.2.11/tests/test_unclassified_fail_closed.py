import pytest

from effect_fabric.models import ExecutionState, ProviderReceipt, ReconciliationStatus
from effect_fabric.testing import FakeExecutor


class MutateThenBug(FakeExecutor):
    async def execute(self, intent, prepared, attempt) -> ProviderReceipt:
        await super().execute(intent, prepared, attempt)
        raise RuntimeError("bug after provider mutation")


@pytest.mark.asyncio
async def test_unclassified_exception_after_effect_fails_closed_to_unknown(basic):
    engine, world, intent, contract, idem, rev = basic
    engine.register_executor(
        MutateThenBug(
            world,
            lambda state, _intent: state.update(
                enabled=True,
                version=state["version"] + 1,
            ),
        )
    )
    tx = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=idem,
        reversibility=rev,
    )
    await engine.prepare(tx.transaction_id, "fake")
    cap = await engine.authorize(tx.transaction_id, "fake")
    result = await engine.execute(tx.transaction_id, cap)
    assert result.execution_state == ExecutionState.UNKNOWN
    assert world.effect_count == 1
    status = await engine.reconcile(tx.transaction_id)
    assert status == ReconciliationStatus.HAPPENED
    assert world.effect_count == 1
