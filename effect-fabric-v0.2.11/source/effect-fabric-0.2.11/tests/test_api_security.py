import pytest
from fastapi.testclient import TestClient

from effect_fabric.api import create_app
from effect_fabric.engine import EffectEngine
from effect_fabric.models import (
    ActionIntent,
    EffectContract,
    IdempotencyContract,
    ReversibilityClass,
    ReversibilitySpec,
)


def test_transaction_endpoint_not_mounted_by_default():
    client = TestClient(create_app())
    assert client.get("/healthz").json() == {"status": "ok"}
    assert client.get("/transactions/anything").status_code == 404


def test_enabling_transaction_api_without_token_fails_closed(monkeypatch):
    monkeypatch.delenv("EFFECT_FABRIC_API_TOKEN", raising=False)
    with pytest.raises(RuntimeError):
        create_app(expose_transactions=True, api_token=None)


@pytest.mark.asyncio
async def test_authenticated_api_returns_redacted_summary(monkeypatch):
    monkeypatch.delenv("EFFECT_FABRIC_API_TOKEN", raising=False)
    engine = EffectEngine()
    intent = ActionIntent(
        subject="agent-a",
        operation="demo.secret",
        resource="demo://r",
        arguments={"secret_argument": "must-not-leak"},
    )
    contract = EffectContract(resource=intent.resource, verifier="unused")
    tx = await engine.propose(
        intent=intent,
        contract=contract,
        idempotency=IdempotencyContract(mechanism="natural_resource", key="api-test"),
        reversibility=ReversibilitySpec(classification=ReversibilityClass.UNKNOWN),
    )
    client = TestClient(
        create_app(engine, expose_transactions=True, api_token="test-token")
    )
    assert client.get(f"/transactions/{tx.transaction_id}").status_code == 401
    response = client.get(
        f"/transactions/{tx.transaction_id}",
        headers={"Authorization": "Bearer test-token"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["transaction_id"] == tx.transaction_id
    assert "arguments" not in body
    assert "receipt" not in body
    assert "secret_argument" not in str(body)
