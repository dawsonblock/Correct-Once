from effect_fabric.models import EffectContract, Predicate, VerificationState
from effect_fabric.predicates import attest, evaluate


def test_nested_predicate_resolution():
    state = {"issue": {"labels": ["security", "bug"]}}
    assert evaluate(Predicate(path="issue.labels", operator="contains", value="security"), state)


def test_forbidden_predicate_fails_when_true():
    contract = EffectContract(
        resource="r",
        expected=[Predicate(path="enabled", operator="eq", value=True)],
        forbidden=[Predicate(path="admin", operator="eq", value=True)],
        verifier="v",
    )
    att = attest("v", contract, {"enabled": True, "admin": True})
    assert att.state == VerificationState.MISMATCH
