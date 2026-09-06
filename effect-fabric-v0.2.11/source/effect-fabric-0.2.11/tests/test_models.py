import pytest

from effect_fabric.models import ReversibilityClass, ReversibilitySpec


def test_compensable_requires_recovery_operation():
    with pytest.raises(ValueError):
        ReversibilitySpec(classification=ReversibilityClass.COMPENSABLE)


def test_irreversible_does_not_require_recovery_operation():
    x = ReversibilitySpec(classification=ReversibilityClass.IRREVERSIBLE)
    assert x.recovery_operation is None
