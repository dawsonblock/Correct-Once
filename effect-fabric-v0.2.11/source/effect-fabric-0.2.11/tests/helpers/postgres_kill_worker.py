from __future__ import annotations

import argparse
import asyncio
import os

from effect_fabric.models import AttemptState, ProviderReceipt
from effect_fabric.outbox import EvidenceIntent, EvidenceOutboxDispatcher
from effect_fabric.postgres import PostgresStore
from effect_fabric.postgres_evidence import PostgresEvidenceLedger
from effect_fabric.transition_kernel import TransitionCommand, apply_transaction_transition


async def run(args) -> None:
    store = await PostgresStore.connect(args.dsn)
    if args.mode == "start":
        await store.consume_capability_and_start(
            capability_id=args.capability_id,
            transaction_id=args.transaction_id,
            executor=args.executor,
            worker_id="killed-worker",
            lease_seconds=1,
            evidence=EvidenceIntent(
                event_type="qualification.process_kill_started",
                payload={"mode": "start"},
            ),
        )
        os._exit(91)

    if args.mode == "ambiguous-effect":
        attempt = await store.consume_capability_and_start(
            capability_id=args.capability_id,
            transaction_id=args.transaction_id,
            executor=args.executor,
            worker_id="killed-worker",
            lease_seconds=1,
            evidence=EvidenceIntent(
                event_type="qualification.process_kill_started",
                payload={"mode": "ambiguous-effect"},
            ),
        )
        # Qualification-only durable marker standing in for a remote provider side effect. It is
        # deliberately committed separately from Effect Fabric's transaction state.
        await store.conn.execute(
            """CREATE TABLE IF NOT EXISTS qualification_external_effects (
                   transaction_id UUID PRIMARY KEY,
                   attempt_id UUID NOT NULL,
                   happened_at TIMESTAMPTZ NOT NULL DEFAULT now()
               )"""
        )
        await store.conn.execute(
            """INSERT INTO qualification_external_effects(transaction_id, attempt_id)
               VALUES (%s, %s)
               ON CONFLICT (transaction_id) DO NOTHING""",
            (args.transaction_id, attempt.attempt_id),
        )
        await store.conn.commit()
        os._exit(93)

    if args.mode == "receipt":
        attempt = await store.consume_capability_and_start(
            capability_id=args.capability_id,
            transaction_id=args.transaction_id,
            executor=args.executor,
            worker_id="killed-worker",
            lease_seconds=30,
            evidence=EvidenceIntent(
                event_type="qualification.process_kill_started",
                payload={"mode": "receipt"},
            ),
        )
        tx = await store.get_transaction(args.transaction_id)
        tx.receipt = ProviderReceipt(
            provider="qualification",
            operation=tx.intent.operation,
            external_id=f"receipt:{attempt.attempt_id}",
            status_code=200,
        )
        apply_transaction_transition(tx, TransitionCommand.RECORD_RECEIPT)
        await store.finalize_attempt_transition(
            tx,
            attempt_id=attempt.attempt_id,
            expected_fence=attempt.fencing_epoch,
            worker_id="killed-worker",
            attempt_state=AttemptState.SUCCEEDED,
            evidence=EvidenceIntent(
                event_type="qualification.process_kill_receipt",
                payload={"attempt_id": attempt.attempt_id},
            ),
        )
        os._exit(94)

    if args.mode == "claim":
        item = await store.claim_evidence(worker_id="killed-dispatcher", lease_seconds=1)
        if item is None:
            raise RuntimeError("no outbox row available for kill qualification")
        os._exit(95)

    if args.mode == "dispatch":
        ledger = PostgresEvidenceLedger(store.conn)
        dispatcher = EvidenceOutboxDispatcher(
            store,
            ledger,
            worker_id="killed-dispatcher",
            lease_seconds=1,
        )

        def kill_after_append(_item, _event):
            os._exit(92)

        await dispatcher.dispatch_one(after_append_hook=kill_after_append)
        raise RuntimeError("dispatcher kill hook did not terminate process")

    raise ValueError(args.mode)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "mode",
        choices=["start", "ambiguous-effect", "receipt", "claim", "dispatch"],
    )
    parser.add_argument("--dsn", required=True)
    parser.add_argument("--transaction-id")
    parser.add_argument("--capability-id")
    parser.add_argument("--executor", default="fake")
    args = parser.parse_args()
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
