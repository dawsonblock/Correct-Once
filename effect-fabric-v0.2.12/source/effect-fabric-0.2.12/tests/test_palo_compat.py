import pytest

from effect_fabric.compat.palo import effect_contract_from_palo
from effect_fabric.predicates import evaluate


def sample():
    return {
        "format": "palo-agentic-effect-contract",
        "schemaVersion": "1.0.0",
        "effectContractId": "effect-00000000-0000-0000-0000-000000000001",
        "resourceSelector": {
            "resource": "catalog:item",
            "path": "/tenant/item-1",
        },
        "preconditions": [
            {
                "predicateId": "predicate-v",
                "path": "/version",
                "operator": "equals",
                "value": 3,
            }
        ],
        "expectedEffects": [
            {
                "predicateId": "predicate-p",
                "path": "/price",
                "operator": "changedTo",
                "value": 120,
            }
        ],
        "forbiddenEffects": [
            {
                "predicateId": "predicate-t",
                "path": "/tenantId",
                "operator": "changedTo",
                "value": "bad",
            }
        ],
        "verification": {
            "windowSeconds": 30,
            "onInconclusive": "hold_and_review",
            "maxAttempts": 1,
        },
    }


def test_palo_basic_contract_import():
    contract = effect_contract_from_palo(sample(), verifier="authoritative")
    assert contract.resource == "catalog:item:/tenant/item-1"
    assert evaluate(contract.preconditions[0], {"version": 3})
    assert evaluate(contract.expected[0], {"price": 120})


def test_json_pointer_escape_support():
    raw = sample()
    raw["preconditions"] = [
        {
            "predicateId": "predicate-x",
            "path": "/a~1b/~0key",
            "operator": "equals",
            "value": 5,
        }
    ]
    contract = effect_contract_from_palo(raw, verifier="v")
    assert evaluate(contract.preconditions[0], {"a/b": {"~key": 5}})


def test_unsupported_palo_operator_fails_closed():
    raw = sample()
    raw["expectedEffects"][0]["operator"] = "unchanged"
    with pytest.raises(ValueError, match="not faithfully supported"):
        effect_contract_from_palo(raw, verifier="v")
