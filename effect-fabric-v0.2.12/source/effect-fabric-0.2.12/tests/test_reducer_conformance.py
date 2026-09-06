from effect_fabric.qualification.donor_conformance import SCENARIO_IDS, run_internal_scenarios


def test_all_17_donor_semantic_scenarios_pass():
    results = run_internal_scenarios()
    assert tuple(r.scenario for r in results) == SCENARIO_IDS
    failures = [r for r in results if not r.passed]
    assert failures == []
