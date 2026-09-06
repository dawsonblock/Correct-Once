import pytest

from effect_fabric.canonical import canonical_json, digest_document
from effect_fabric.models import ActionIntent, EffectContract


def test_dict_order_is_canonical():
    assert canonical_json({"b": 2, "a": 1}) == canonical_json({"a": 1, "b": 2})


def test_floats_are_rejected():
    with pytest.raises(TypeError):
        canonical_json({"amount": 1.25})


def test_digest_changes_when_argument_changes():
    c = EffectContract(resource="x", verifier="v")
    a = ActionIntent(subject="s", operation="o", resource="x", arguments={"n": 1})
    b = ActionIntent(subject="s", operation="o", resource="x", arguments={"n": 2})
    assert a.action_digest(c) != b.action_digest(c)


def test_document_digest_stable():
    assert digest_document({"x": [1, 2]}) == digest_document({"x": [1, 2]})
