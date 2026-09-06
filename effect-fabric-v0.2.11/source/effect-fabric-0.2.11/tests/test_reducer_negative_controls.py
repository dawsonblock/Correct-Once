from effect_fabric.qualification.donor_conformance import SCENARIO_IDS
from effect_fabric.qualification.reducer_mutants import ALL_MUTANTS, run_negative_controls


def test_negative_controls_have_declared_scenario_floor():
    known = set(SCENARIO_IDS)
    assert len(ALL_MUTANTS) == 8
    for mutant in ALL_MUTANTS:
        assert mutant.must_fail
        assert set(mutant.must_fail) <= known


def test_all_negative_controls_are_discriminated_without_crashing():
    results = run_negative_controls()
    assert len(results) == 8
    for result in results:
        assert not result.crashed, result
        assert not result.passed_suite, result
        assert result.required_failures_observed, result


def test_nop_negative_control_fails_every_scenario():
    result = next(item for item in run_negative_controls() if item.mutant == "nop")
    assert set(result.failed_scenarios) == set(SCENARIO_IDS)
