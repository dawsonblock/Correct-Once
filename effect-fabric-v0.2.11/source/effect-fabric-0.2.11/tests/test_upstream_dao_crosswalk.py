from effect_fabric.qualification.upstream_dao import (
    UPSTREAM_MUTANT_TO_INTERNAL,
    UPSTREAM_SCENARIO_TO_INTERNAL,
    validate_crosswalk,
)


def test_locked_upstream_crosswalk_is_complete() -> None:
    mutants = {
        "eagerResolve": ["03", "04", "05"],
        "ackedRevoked": ["06"],
        "strandsInDoubt": ["07", "13"],
        "deliveryKeyed": ["01", "11"],
        "selfRevoke": ["14"],
        "trustsAnyReceipt": ["16"],
        "noncesAreConsumed": ["17"],
        "nop": list(UPSTREAM_SCENARIO_TO_INTERNAL),
    }
    result = validate_crosswalk(
        upstream_scenario_ids=UPSTREAM_SCENARIO_TO_INTERNAL,
        upstream_mutants=mutants,
    )
    assert result.passed, result.errors
    assert len(UPSTREAM_SCENARIO_TO_INTERNAL) == 17
    assert len(UPSTREAM_MUTANT_TO_INTERNAL) == 8


def test_crosswalk_fails_closed_on_new_scenario() -> None:
    result = validate_crosswalk(
        upstream_scenario_ids=[*UPSTREAM_SCENARIO_TO_INTERNAL, "18"],
        upstream_mutants={name: [] for name in UPSTREAM_MUTANT_TO_INTERNAL},
    )
    assert not result.passed
    assert any("scenario ids changed" in error for error in result.errors)


def test_crosswalk_fails_closed_on_new_mutant() -> None:
    result = validate_crosswalk(
        upstream_scenario_ids=UPSTREAM_SCENARIO_TO_INTERNAL,
        upstream_mutants={**{name: [] for name in UPSTREAM_MUTANT_TO_INTERNAL}, "newBug": ["01"]},
    )
    assert not result.passed
    assert any("mutant ids changed" in error for error in result.errors)
