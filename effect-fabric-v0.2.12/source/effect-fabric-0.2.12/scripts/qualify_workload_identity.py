#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from effect_fabric.engine import EffectEngine
from effect_fabric.errors import AuthorizationError
from effect_fabric.identity import WorkloadAuthority, WorkloadSigner, WorkloadVerifier
from effect_fabric.models import (
    ActionIntent,
    EffectContract,
    IdempotencyContract,
    ReversibilityClass,
    ReversibilitySpec,
)
from effect_fabric.qualification.provenance import PACKAGE_VERSION
from effect_fabric.testing import FakeExecutor, FakeWorld


async def run() -> dict[str, object]:
    authority = WorkloadAuthority(key_id="qualification-authority")
    verifier = WorkloadVerifier.from_authority(authority)
    signer = WorkloadSigner.enroll(
        authority,
        worker_id="qualification-worker",
        subject="qualification-agent",
        environment_id="qualification",
        release_id=PACKAGE_VERSION,
    )
    world = FakeWorld({"enabled": False})
    engine = EffectEngine(
        workload_verifier=verifier,
        require_workload_identity=True,
        environment_id="qualification",
        release_id=PACKAGE_VERSION,
    )
    engine.register_executor(FakeExecutor(world, lambda state, _intent: state.update(enabled=True)))
    intent = ActionIntent(
        subject="qualification-agent",
        operation="qualification.enable",
        resource="qualification://feature",
    )
    contract = EffectContract(resource=intent.resource, verifier="not-used")
    tx = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=IdempotencyContract(
            mechanism="natural_resource",
            key="qualification:workload-identity",
        ),
        reversibility=ReversibilitySpec(classification=ReversibilityClass.UNKNOWN),
    )
    await engine.prepare(tx.transaction_id, "fake")
    cap = await engine.authorize(tx.transaction_id, "fake")

    missing_identity_denied = False
    try:
        await engine.execute(tx.transaction_id, cap, worker_id="qualification-worker")
    except AuthorizationError:
        missing_identity_denied = True

    result = await engine.execute(
        tx.transaction_id,
        cap,
        worker_id="qualification-worker",
        workload_signer=signer,
    )
    attempt = await engine.store.get_attempt(result.latest_attempt_id)
    events = engine.ledger.events()
    started = next(event for event in events if event.event_type == "effect.started")
    receipt = next(event for event in events if event.event_type == "effect.receipt_recorded")

    wrong_release_denied = False
    wrong_signer = WorkloadSigner.enroll(
        authority,
        worker_id="qualification-worker",
        subject="qualification-agent",
        environment_id="qualification",
        release_id="wrong-release",
    )
    wrong_assertion = wrong_signer.sign(
        kind="effect.execute.start",
        transaction_id="tx-x",
        action_digest="digest-x",
        executor="fake",
    )
    try:
        verifier.verify_assertion(
            wrong_assertion,
            expected_release_id=PACKAGE_VERSION,
            expected_worker_id="qualification-worker",
            expected_subject="qualification-agent",
            expected_environment_id="qualification",
        )
    except Exception:
        wrong_release_denied = True

    checks = {
        "missing_identity_denied_before_execution": missing_identity_denied,
        "signed_execution_succeeded": world.effect_count == 1,
        "attempt_persists_credential_id": (
            attempt.workload_credential_id == signer.credential.credential_id
        ),
        "attempt_persists_identity_digest": (
            attempt.workload_identity_digest == signer.credential.digest
        ),
        "started_evidence_contains_signed_assertion": (
            started.payload.get("workload_assertion", {}).get("worker_id")
            == "qualification-worker"
        ),
        "outcome_assertion_bound_to_attempt": (
            receipt.payload.get("workload_assertion", {}).get("attempt_id")
            == attempt.attempt_id
        ),
        "wrong_release_rejected": wrong_release_denied,
        "ledger_integrity": engine.ledger.verify(),
    }
    return {
        "schema": "effect-fabric/workload-identity-qualification/v1",
        "version": PACKAGE_VERSION,
        "status": "PASS" if all(checks.values()) else "FAIL",
        "checks": checks,
        "claim": (
            "Locally generated Ed25519 authority credentials bind worker, subject, environment, "
            "and release; EffectEngine can require them and emits signed attempt/outcome evidence. "
            "This is not a production KMS/attestation qualification."
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("WORKLOAD_IDENTITY_QUALIFICATION.json"),
    )
    args = parser.parse_args()
    report = asyncio.run(run())
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
