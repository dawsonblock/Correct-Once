from __future__ import annotations

import argparse
import asyncio
import json
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

from effect_fabric.engine import EffectEngine
from effect_fabric.faults import FaultInjector, SimulatedCrash
from effect_fabric.ledger import FileHashChainLedger, HashChainLedger
from effect_fabric.models import (
    ActionIntent,
    EffectContract,
    IdempotencyContract,
    ReversibilityClass,
    ReversibilitySpec,
)
from effect_fabric.outbox import EvidenceIntent, EvidenceOutboxDispatcher
from effect_fabric.store import InMemoryStore
from effect_fabric.testing import FakeExecutor, FakeVerifier, FakeWorld


def build_engine() -> tuple[EffectEngine, FakeWorld, ActionIntent, EffectContract]:
    world = FakeWorld({"enabled": False, "version": 1})

    def mutation(state, intent):
        del intent
        state["enabled"] = True
        state["version"] += 1

    engine = EffectEngine()
    engine.register_executor(FakeExecutor(world, mutation))
    engine.register_verifier(FakeVerifier(world))
    intent = ActionIntent(
        subject="qualification-agent",
        operation="demo.enable",
        resource="demo://x",
    )
    contract = EffectContract(resource=intent.resource, verifier="fake-verifier")
    return engine, world, intent, contract


async def run() -> dict[str, object]:
    results: list[dict] = []

    engine, world, intent, contract = build_engine()
    tx = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=IdempotencyContract(mechanism="natural_resource", key="q-start"),
        reversibility=ReversibilitySpec(classification=ReversibilityClass.UNKNOWN),
    )
    await engine.prepare(tx.transaction_id, "fake")
    cap = await engine.authorize(tx.transaction_id, "fake")
    engine.faults = FaultInjector(armed={"after_started_transition_committed"})
    try:
        await engine.execute(tx.transaction_id, cap)
        raise AssertionError("expected simulated crash")
    except SimulatedCrash:
        pass
    current = await engine.store.get_transaction(tx.transaction_id)
    assert current.execution_state.value == "started"
    assert world.effect_count == 0
    assert await engine.store.pending_evidence_count() == 1
    results.append({"scenario": "state_plus_outbox_survives_pre_flush_crash", "status": "PASS"})

    engine.faults.armed.clear()
    before = engine.ledger.count
    await engine.flush_evidence()
    assert engine.ledger.count == before + 1
    assert await engine.store.pending_evidence_count() == 0
    results.append({"scenario": "pending_intent_replays_after_restart_boundary", "status": "PASS"})

    ledger = HashChainLedger()
    first = ledger.append("tx", "e", source_outbox_id="same")
    second = ledger.append("tx", "e", source_outbox_id="same")
    assert first.event_id == second.event_id and ledger.count == 1
    results.append({"scenario": "ledger_outbox_idempotency", "status": "PASS"})

    store = InMemoryStore()
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "events.jsonl"
        file_ledger = FileHashChainLedger(path)
        item = await store.enqueue_evidence("tx", EvidenceIntent(event_type="e", payload={"n": 1}))
        dispatcher = EvidenceOutboxDispatcher(store, file_ledger, worker_id="a", lease_seconds=1)

        def crash(_item, _event):
            raise SimulatedCrash("after_append")

        try:
            await dispatcher.dispatch_one(after_append_hook=crash)
            raise AssertionError("expected simulated crash")
        except SimulatedCrash:
            pass
        assert file_ledger.count == 1
        store._outbox[item.outbox_id].claim_expires_at = datetime.now(UTC) - timedelta(seconds=1)
        replacement = EvidenceOutboxDispatcher(store, file_ledger, worker_id="b")
        replay = await replacement.dispatch_one()
        assert replay is not None and file_ledger.count == 1
        reopened = FileHashChainLedger(path)
        assert reopened.verify() and reopened.count == 1
    results.append({"scenario": "append_before_ack_redelivery_is_idempotent", "status": "PASS"})
    results.append({"scenario": "file_ledger_restart_preserves_outbox_identity", "status": "PASS"})

    broken_store = InMemoryStore()
    await broken_store.enqueue_evidence("tx", EvidenceIntent(event_type="e"))

    class BrokenLedger(HashChainLedger):
        def append(self, *args, **kwargs):
            raise RuntimeError("sink unavailable")

    failing = EvidenceOutboxDispatcher(broken_store, BrokenLedger(), worker_id="bad")
    try:
        await failing.dispatch_one()
        raise AssertionError("expected sink failure")
    except RuntimeError:
        pass
    assert await broken_store.pending_evidence_count() == 1
    results.append({"scenario": "sink_failure_returns_intent_to_pending", "status": "PASS"})

    summary = {
        "qualification": "transactional-evidence-local",
        "version": "0.2.11",
        "status": "PASS" if all(r["status"] == "PASS" for r in results) else "FAIL",
        "passed": sum(r["status"] == "PASS" for r in results),
        "total": len(results),
        "scenarios": results,
        "limitations": [
            "PostgreSQL process-kill qualification is a separate CI/live gate.",
            "External WORM anchoring and KMS/HSM key custody are not exercised here.",
        ],
    }
    return summary


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output", type=Path, default=Path("TRANSACTIONAL_EVIDENCE_QUALIFICATION.json")
    )
    args = parser.parse_args()
    output = asyncio.run(run())
    args.output.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n")
    print(json.dumps(output, indent=2, sort_keys=True))
    return 0 if output["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
