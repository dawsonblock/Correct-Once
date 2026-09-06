import pytest

from effect_fabric.models import ExecutionState, ReconciliationStatus
from effect_fabric.testing import FakeExecutor


class BrokenReconciler(FakeExecutor):
    async def reconcile(self, intent, prepared, attempt):
        raise RuntimeError("authoritative provider unavailable")


@pytest.mark.asyncio
async def test_reconciliation_exception_leaves_effect_unknown(basic):
    engine, world, intent, contract, idem, rev = basic
    engine.register_executor(
        BrokenReconciler(
            world,
            lambda state, _intent: state.update(
                enabled=True,
                version=state["version"] + 1,
            ),
            ambiguous_after_effect=True,
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
    await engine.execute(tx.transaction_id, cap)

    status = await engine.reconcile(tx.transaction_id)
    assert status == ReconciliationStatus.UNKNOWN
    current = await engine.store.get_transaction(tx.transaction_id)
    assert current.execution_state == ExecutionState.UNKNOWN
    assert any(
        event.event_type == "effect.reconciliation_inconclusive"
        for event in engine.ledger.events()
    )
