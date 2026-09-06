import pytest

from effect_fabric.engine import EffectEngine
from effect_fabric.errors import ProviderErrorKind, ProviderExecutionError
from effect_fabric.models import (
    ActionIntent,
    EffectContract,
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


async def _prepared_engine(server, *, value="target", attempts=3, key="q"):
    config = QualificationProviderConfig(api_base=server.base_url)
    engine = EffectEngine()
    engine.register_executor(QualificationProviderExecutor(config))
    engine.register_verifier(QualificationProviderVerifier(config))
    intent = ActionIntent(
        subject="qualification-agent",
        operation="qualification.state.set",
        resource="qualification://state",
        arguments={"value": value},
    )
    contract = EffectContract(
        resource=intent.resource,
        preconditions=[Predicate(path="value", operator="eq", value="initial")],
        expected=[Predicate(path="value", operator="eq", value=value)],
        verifier="qualification-provider-verifier",
        max_verification_attempts=attempts,
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


@pytest.mark.asyncio
async def test_local_http_success_is_independently_verified():
    with QualificationProviderServer(QualificationScenario.SUCCESS) as server:
        engine, tx, cap = await _prepared_engine(server, key="success")
        result = await engine.execute(tx.transaction_id, cap)
        assert result.execution_state == ExecutionState.RECEIPT_RECORDED
        assert result.receipt is not None
        assert result.receipt.response_digest
        att = await engine.verify(tx.transaction_id)
        assert att.state == VerificationState.VERIFIED
        assert att.attempts == 1
        assert server.state.mutation_count == 1


@pytest.mark.asyncio
async def test_mutate_then_drop_reconciles_without_second_effect():
    with QualificationProviderServer(QualificationScenario.MUTATE_THEN_DROP) as server:
        engine, tx, cap = await _prepared_engine(server, key="mutate-drop")
        result = await engine.execute(tx.transaction_id, cap)
        assert result.execution_state == ExecutionState.UNKNOWN
        assert server.state.mutation_count == 1
        status = await engine.reconcile(tx.transaction_id)
        assert status == ReconciliationStatus.HAPPENED
        current = await engine.store.get_transaction(tx.transaction_id)
        assert current.execution_state == ExecutionState.RECONCILED
        att = await engine.verify(tx.transaction_id)
        assert att.state == VerificationState.VERIFIED
        assert server.state.mutation_count == 1


@pytest.mark.asyncio
async def test_drop_before_mutate_reconciles_not_happened_and_requires_fresh_authorization():
    with QualificationProviderServer(QualificationScenario.DROP_BEFORE_MUTATE) as server:
        engine, tx, cap = await _prepared_engine(server, key="drop-before")
        result = await engine.execute(tx.transaction_id, cap)
        assert result.execution_state == ExecutionState.UNKNOWN
        assert server.state.mutation_count == 0
        status = await engine.reconcile(tx.transaction_id)
        assert status == ReconciliationStatus.NOT_HAPPENED
        current = await engine.store.get_transaction(tx.transaction_id)
        assert current.execution_state == ExecutionState.PREPARED
        assert current.capability_id is None


@pytest.mark.asyncio
async def test_pre_effect_unavailable_is_retryable_but_requires_new_capability():
    with QualificationProviderServer(QualificationScenario.PRE_EFFECT_UNAVAILABLE) as server:
        engine, tx, cap = await _prepared_engine(server, key="pre-unavailable")
        with pytest.raises(ProviderExecutionError) as caught:
            await engine.execute(tx.transaction_id, cap)
        assert caught.value.kind == ProviderErrorKind.RETRYABLE_PRE_EFFECT
        assert caught.value.safe_to_retry is True
        assert caught.value.may_have_happened is False
        current = await engine.store.get_transaction(tx.transaction_id)
        assert current.execution_state == ExecutionState.PREPARED
        assert current.capability_id is None
        assert server.state.mutation_count == 0


@pytest.mark.asyncio
async def test_rate_limit_before_effect_is_retryable_and_does_not_mutate():
    with QualificationProviderServer(QualificationScenario.RATE_LIMITED) as server:
        engine, tx, cap = await _prepared_engine(server, key="rate-limited")
        with pytest.raises(ProviderExecutionError) as caught:
            await engine.execute(tx.transaction_id, cap)
        assert caught.value.kind == ProviderErrorKind.RATE_LIMITED
        assert caught.value.safe_to_retry is True
        assert caught.value.may_have_happened is False
        assert server.state.mutation_count == 0


@pytest.mark.asyncio
async def test_definitive_rejection_is_not_automatically_rearmed():
    with QualificationProviderServer(QualificationScenario.DEFINITIVE_REJECTION) as server:
        engine, tx, cap = await _prepared_engine(server, key="rejection")
        with pytest.raises(ProviderExecutionError) as caught:
            await engine.execute(tx.transaction_id, cap)
        assert caught.value.kind == ProviderErrorKind.DEFINITIVE_REJECTION
        current = await engine.store.get_transaction(tx.transaction_id)
        assert current.execution_state == ExecutionState.EXECUTION_FAILED
        assert server.state.mutation_count == 0


@pytest.mark.asyncio
async def test_protocol_violation_after_mutation_becomes_unknown_then_reconciles():
    with QualificationProviderServer(
        QualificationScenario.PROTOCOL_VIOLATION_AFTER_MUTATION
    ) as server:
        engine, tx, cap = await _prepared_engine(server, key="protocol-after")
        result = await engine.execute(tx.transaction_id, cap)
        assert result.execution_state == ExecutionState.UNKNOWN
        assert server.state.mutation_count == 1
        status = await engine.reconcile(tx.transaction_id)
        assert status == ReconciliationStatus.HAPPENED
        assert server.state.mutation_count == 1


@pytest.mark.asyncio
async def test_eventual_visibility_retries_observation_before_verifying():
    with QualificationProviderServer(QualificationScenario.EVENTUAL_VISIBILITY) as server:
        engine, tx, cap = await _prepared_engine(server, attempts=3, key="eventual")
        await engine.execute(tx.transaction_id, cap)
        att = await engine.verify(tx.transaction_id)
        assert att.state == VerificationState.VERIFIED
        assert att.attempts == 3
        assert att.details["observation_metadata"]["consistency"] == "stable"


@pytest.mark.asyncio
async def test_verifier_outage_exhausts_budget_as_inconclusive():
    with QualificationProviderServer(QualificationScenario.VERIFIER_UNAVAILABLE) as server:
        engine, tx, cap = await _prepared_engine(server, attempts=3, key="verify-outage")
        await engine.execute(tx.transaction_id, cap)
        att = await engine.verify(tx.transaction_id)
        assert att.state == VerificationState.INCONCLUSIVE
        assert att.attempts == 3
        assert att.details["kind"] == "provider_unavailable"


@pytest.mark.asyncio
async def test_third_party_drift_is_mismatch_not_transport_failure():
    with QualificationProviderServer(QualificationScenario.THIRD_PARTY_DRIFT) as server:
        engine, tx, cap = await _prepared_engine(server, key="drift")
        await engine.execute(tx.transaction_id, cap)
        att = await engine.verify(tx.transaction_id)
        assert att.state == VerificationState.MISMATCH
        assert att.attempts == 1
