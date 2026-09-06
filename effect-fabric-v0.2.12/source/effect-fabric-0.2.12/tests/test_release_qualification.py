from effect_fabric.qualification.release import GateStatus, ReleaseQualification


def test_release_qualification_does_not_promote_not_run_to_pass():
    record = ReleaseQualification.from_mapping(
        version="0.2.12",
        gates={"core": "PASS", "postgres": "NOT_RUN"},
    )
    assert record.overall == "REFERENCE_QUALIFIED"


def test_release_qualification_fails_if_any_gate_fails():
    record = ReleaseQualification.from_mapping(
        version="0.2.12",
        gates={"core": GateStatus.PASS, "typing": GateStatus.FAIL},
    )
    assert record.overall == "FAILED"


def test_release_qualification_is_qualified_only_if_every_gate_passes():
    record = ReleaseQualification.from_mapping(
        version="0.2.12",
        gates={"core": "PASS", "postgres": "PASS", "typing": "PASS"},
    )
    assert record.overall == "QUALIFIED"
