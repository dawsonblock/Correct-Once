import urllib.error

import pytest

from effect_fabric.adapters.github import GitHubConfig, GitHubIssueLabelExecutor
from effect_fabric.errors import ProviderErrorKind, ProviderExecutionError
from effect_fabric.models import (
    ActionIntent,
    ExecutionAttempt,
    PreparedEffect,
)


def intent():
    return ActionIntent(
        subject="agent",
        operation="github.issue.add_label",
        resource="github://org/repo/issues/1",
        arguments={"repo": "org/repo", "issue": 1, "label": "safe"},
    )


@pytest.mark.asyncio
async def test_github_401_is_definitive_authentication_failure():
    executor = GitHubIssueLabelExecutor(GitHubConfig(token="x"))

    async def fail(*args, **kwargs):
        del args, kwargs
        raise urllib.error.HTTPError("url", 401, "no", {}, None)

    executor.http.request = fail
    with pytest.raises(ProviderExecutionError) as caught:
        await executor.execute(
            intent(),
            PreparedEffect(observed_pre_state={}),
            ExecutionAttempt(transaction_id="tx", executor=executor.name, fencing_epoch=1),
        )
    assert caught.value.kind == ProviderErrorKind.AUTHENTICATION
    assert caught.value.may_have_happened is False


@pytest.mark.asyncio
async def test_github_500_is_ambiguous_and_not_safe_to_retry():
    executor = GitHubIssueLabelExecutor(GitHubConfig(token="x"))

    async def fail(*args, **kwargs):
        del args, kwargs
        raise urllib.error.HTTPError("url", 500, "boom", {}, None)

    executor.http.request = fail
    with pytest.raises(ProviderExecutionError) as caught:
        await executor.execute(
            intent(),
            PreparedEffect(observed_pre_state={}),
            ExecutionAttempt(transaction_id="tx", executor=executor.name, fencing_epoch=1),
        )
    assert caught.value.may_have_happened is True
    assert caught.value.safe_to_retry is False

@pytest.mark.asyncio
async def test_verifier_rate_limit_is_retryable(monkeypatch):
    from effect_fabric.adapters.github import GitHubIssueVerifier
    from effect_fabric.errors import VerifierErrorKind, VerifierObservationError
    from effect_fabric.models import ActionIntent, EffectContract

    verifier = GitHubIssueVerifier(GitHubConfig(token="x"))

    async def fail(*args, **kwargs):
        raise urllib.error.HTTPError(
            url="https://api.github.com/test",
            code=429,
            msg="rate limited",
            hdrs={"Retry-After": "1"},
            fp=None,
        )

    monkeypatch.setattr(verifier.http, "request", fail)
    intent = ActionIntent(
        subject="a",
        operation="github.issue.add_label",
        resource="github://o/r/issues/1",
        arguments={"repo": "o/r", "issue": 1, "label": "x"},
    )
    contract = EffectContract(resource=intent.resource, verifier=verifier.name)
    with pytest.raises(VerifierObservationError) as caught:
        await verifier.observe(intent, contract)
    assert caught.value.kind == VerifierErrorKind.RATE_LIMITED
    assert caught.value.retryable is True

@pytest.mark.asyncio
async def test_github_execute_refuses_changed_prepared_etag_before_mutation():
    executor = GitHubIssueLabelExecutor(GitHubConfig(token="x"))
    calls: list[str] = []

    async def request(method, path, payload=None):
        del path, payload
        calls.append(method)
        if method == "GET":
            return 200, {"state": "open", "labels": []}, {"ETag": '"v2"'}
        raise AssertionError("mutation must not be attempted after an ETag mismatch")

    executor.http.request = request
    with pytest.raises(ProviderExecutionError) as caught:
        await executor.execute(
            intent(),
            PreparedEffect(observed_pre_state={}, external_version='"v1"'),
            ExecutionAttempt(transaction_id="tx", executor=executor.name, fencing_epoch=1),
        )
    assert caught.value.kind == ProviderErrorKind.DEFINITIVE_REJECTION
    assert caught.value.may_have_happened is False
    assert calls == ["GET"]


@pytest.mark.asyncio
async def test_github_execute_revalidates_matching_etag_then_mutates():
    executor = GitHubIssueLabelExecutor(GitHubConfig(token="x"))
    calls: list[str] = []

    async def request(method, path, payload=None):
        del path, payload
        calls.append(method)
        if method == "GET":
            return 200, {"state": "open", "labels": []}, {"ETag": '"v1"'}
        if method == "POST":
            return 200, [{"name": "safe"}], {}
        raise AssertionError(method)

    executor.http.request = request
    receipt = await executor.execute(
        intent(),
        PreparedEffect(observed_pre_state={}, external_version='"v1"'),
        ExecutionAttempt(transaction_id="tx", executor=executor.name, fencing_epoch=1),
    )
    assert calls == ["GET", "POST"]
    assert receipt.metadata["precondition_revalidated"] is True
    assert receipt.metadata["prepared_external_version"] == '"v1"'
