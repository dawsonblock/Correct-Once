#!/usr/bin/env python3
"""Manual live GitHub qualification.

This script mutates one explicitly supplied disposable issue by adding, verifying, then removing a
pre-existing label. It refuses to run unless the operator supplies an explicit acknowledgement.
"""

from __future__ import annotations

import asyncio
import os

from effect_fabric.adapters.github import (
    GitHubConfig,
    GitHubIssueLabelExecutor,
    GitHubIssueVerifier,
)
from effect_fabric.engine import EffectEngine
from effect_fabric.models import (
    ActionIntent,
    EffectContract,
    IdempotencyContract,
    Predicate,
    ReversibilityClass,
    ReversibilitySpec,
    VerificationState,
)

ACK = "I_UNDERSTAND_THIS_MUTATES_A_DISPOSABLE_GITHUB_ISSUE"


async def main_async() -> int:
    if os.environ.get("EFFECT_FABRIC_LIVE_GITHUB_ACK") != ACK:
        raise SystemExit(f"refusing live mutation; set EFFECT_FABRIC_LIVE_GITHUB_ACK={ACK}")
    token = os.environ["EFFECT_FABRIC_GITHUB_TOKEN"]
    repo = os.environ["EFFECT_FABRIC_GITHUB_REPO"]
    issue = int(os.environ["EFFECT_FABRIC_GITHUB_ISSUE"])
    label = os.environ["EFFECT_FABRIC_GITHUB_LABEL"]

    config = GitHubConfig(token=token)
    engine = EffectEngine()
    engine.register_executor(GitHubIssueLabelExecutor(config))
    engine.register_verifier(GitHubIssueVerifier(config))
    resource = f"github://{repo}/issues/{issue}"

    add_intent = ActionIntent(
        subject="live-qualification",
        operation="github.issue.add_label",
        resource=resource,
        arguments={"repo": repo, "issue": issue, "label": label},
    )
    add_contract = EffectContract(
        resource=resource,
        preconditions=[Predicate(path="labels", operator="not_contains", value=label)],
        expected=[Predicate(path="labels", operator="contains", value=label)],
        verifier="github-issue-verifier",
        max_verification_attempts=3,
    )
    add_tx = await engine.propose(
        intent=add_intent,
        contract=add_contract,
        idempotency=IdempotencyContract(
            mechanism="natural_resource",
            key=f"live:add:{repo}:{issue}:{label}",
        ),
        reversibility=ReversibilitySpec(
            classification=ReversibilityClass.COMPENSABLE,
            recovery_operation="github.issue.remove_label",
        ),
    )
    await engine.prepare(add_tx.transaction_id, "github-issue-label")
    add_cap = await engine.authorize(add_tx.transaction_id, "github-issue-label")
    await engine.execute(add_tx.transaction_id, add_cap, worker_id="live-github")
    add_att = await engine.verify(add_tx.transaction_id)
    if add_att.state != VerificationState.VERIFIED:
        raise RuntimeError(f"add-label verification failed: {add_att.state}")

    remove_intent = ActionIntent(
        subject="live-qualification",
        operation="github.issue.remove_label",
        resource=resource,
        arguments={"repo": repo, "issue": issue, "label": label},
        parent_intent_id=add_intent.intent_id,
    )
    remove_contract = EffectContract(
        resource=resource,
        expected=[Predicate(path="labels", operator="not_contains", value=label)],
        verifier="github-issue-verifier",
        max_verification_attempts=3,
    )
    remove_tx = await engine.propose(
        intent=remove_intent,
        contract=remove_contract,
        idempotency=IdempotencyContract(
            mechanism="natural_resource",
            key=f"live:remove:{repo}:{issue}:{label}",
        ),
        reversibility=ReversibilitySpec(classification=ReversibilityClass.UNKNOWN),
    )
    await engine.prepare(remove_tx.transaction_id, "github-issue-label")
    remove_cap = await engine.authorize(remove_tx.transaction_id, "github-issue-label")
    await engine.execute(remove_tx.transaction_id, remove_cap, worker_id="live-github")
    remove_att = await engine.verify(remove_tx.transaction_id)
    if remove_att.state != VerificationState.VERIFIED:
        raise RuntimeError(f"cleanup verification failed: {remove_att.state}")

    print("LIVE_GITHUB_QUALIFICATION=PASS")
    print(f"ledger_valid={engine.ledger.verify()}")
    return 0


def main() -> int:
    return asyncio.run(main_async())


if __name__ == "__main__":
    raise SystemExit(main())
