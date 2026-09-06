#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
from typing import Any

from effect_fabric.engine import EffectEngine
from effect_fabric.errors import ProviderExecutionError
from effect_fabric.models import (
    ActionIntent,
    EffectContract,
    EffectTransaction,
    ExecutionCapability,
    ExecutionState,
    IdempotencyContract,
    Predicate,
    ReconciliationStatus,
    ReversibilityClass,
    ReversibilitySpec,
    VerificationState,
)
from effect_fabric.qualification import (
    QualificationProviderConfig,
    QualificationProviderExecutor,
    QualificationProviderServer,
    QualificationProviderVerifier,
    QualificationScenario,
)


async def _setup(
    server: QualificationProviderServer, key: str
) -> tuple[EffectEngine, EffectTransaction, ExecutionCapability]:
    config = QualificationProviderConfig(api_base=server.base_url)
    engine = EffectEngine()
    engine.register_executor(QualificationProviderExecutor(config))
    engine.register_verifier(QualificationProviderVerifier(config))
    intent = ActionIntent(
        subject="qualification-agent",
        operation="qualification.state.set",
        resource="qualification://state",
        arguments={"value": "target"},
    )
    contract = EffectContract(
        resource=intent.resource,
        preconditions=[Predicate(path="value", operator="eq", value="initial")],
        expected=[Predicate(path="value", operator="eq", value="target")],
        verifier="qualification-provider-verifier",
        max_verification_attempts=3,
    )
    tx = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=IdempotencyContract(mechanism="reconcile_only", key=key),
        reversibility=ReversibilitySpec(classification=ReversibilityClass.UNKNOWN),
    )
    await engine.prepare(tx.transaction_id, "qualification-provider")
    cap = await engine.authorize(tx.transaction_id, "qualification-provider")
    return engine, tx, cap


async def _run_scenario(scenario: QualificationScenario) -> dict[str, Any]:
    with QualificationProviderServer(scenario) as server:
        engine, tx, cap = await _setup(server, f"qualification:{scenario.value}")
        error: dict[str, Any] | None = None
        try:
            result = await engine.execute(tx.transaction_id, cap)
        except ProviderExecutionError as exc:
            result = await engine.store.get_transaction(tx.transaction_id)
            error = {
                "kind": exc.kind.value,
                "may_have_happened": exc.may_have_happened,
                "safe_to_retry": exc.safe_to_retry,
            }

        reconciliation = None
        if result.execution_state == ExecutionState.UNKNOWN:
            reconciliation = (await engine.reconcile(tx.transaction_id)).value
            result = await engine.store.get_transaction(tx.transaction_id)

        verification = None
        verification_attempts = None
        if result.execution_state in {
            ExecutionState.RECEIPT_RECORDED,
            ExecutionState.RECONCILED,
            ExecutionState.EXECUTION_FAILED,
        }:
            att = await engine.verify(tx.transaction_id)
            verification = att.state.value
            verification_attempts = att.attempts

        expected = {
            QualificationScenario.SUCCESS: {
                "state": ExecutionState.RECEIPT_RECORDED.value,
                "verification": VerificationState.VERIFIED.value,
            },
            QualificationScenario.MUTATE_THEN_DROP: {
                "state": ExecutionState.RECONCILED.value,
                "reconciliation": ReconciliationStatus.HAPPENED.value,
                "verification": VerificationState.VERIFIED.value,
            },
            QualificationScenario.DROP_BEFORE_MUTATE: {
                "state": ExecutionState.PREPARED.value,
                "reconciliation": ReconciliationStatus.NOT_HAPPENED.value,
            },
            QualificationScenario.DEFINITIVE_REJECTION: {
                "state": ExecutionState.EXECUTION_FAILED.value,
            },
            QualificationScenario.PRE_EFFECT_UNAVAILABLE: {
                "state": ExecutionState.PREPARED.value,
            },
            QualificationScenario.RATE_LIMITED: {
                "state": ExecutionState.PREPARED.value,
            },
            QualificationScenario.PROTOCOL_VIOLATION_AFTER_MUTATION: {
                "state": ExecutionState.RECONCILED.value,
                "reconciliation": ReconciliationStatus.HAPPENED.value,
                "verification": VerificationState.VERIFIED.value,
            },
            QualificationScenario.EVENTUAL_VISIBILITY: {
                "state": ExecutionState.RECEIPT_RECORDED.value,
                "verification": VerificationState.VERIFIED.value,
                "verification_attempts": 3,
            },
            QualificationScenario.VERIFIER_UNAVAILABLE: {
                "state": ExecutionState.RECEIPT_RECORDED.value,
                "verification": VerificationState.INCONCLUSIVE.value,
                "verification_attempts": 3,
            },
            QualificationScenario.THIRD_PARTY_DRIFT: {
                "state": ExecutionState.RECEIPT_RECORDED.value,
                "verification": VerificationState.MISMATCH.value,
            },
        }[scenario]
        observed = {
            "state": result.execution_state.value,
            "reconciliation": reconciliation,
            "verification": verification,
            "verification_attempts": verification_attempts,
        }
        passed = all(observed.get(key) == value for key, value in expected.items())
        return {
            "scenario": scenario.value,
            "passed": passed,
            "expected": expected,
            "observed": observed,
            "provider_error": error,
            "mutation_count": server.state.mutation_count,
            "observation_count": server.state.observation_count,
            "ledger_valid": engine.ledger.verify(),
        }


async def run_all() -> dict[str, Any]:
    results = []
    for scenario in QualificationScenario:
        results.append(await _run_scenario(scenario))
    return {
        "schema_version": "effect-fabric-provider-qualification/v1",
        "all_passed": all(item["passed"] and item["ledger_valid"] for item in results),
        "results": results,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = asyncio.run(run_all())
    text = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(text)
    print(text, end="")
    return 0 if report["all_passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
