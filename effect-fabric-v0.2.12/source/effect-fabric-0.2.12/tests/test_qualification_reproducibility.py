from pathlib import Path


def test_stable_qualification_outputs_do_not_embed_runtime_timestamp():
    for name in (
        "PROVIDER_QUALIFICATION.json",
        "EVIDENCE_QUALIFICATION.json",
        "TRANSACTIONAL_EVIDENCE_QUALIFICATION.json",
    ):
        path = Path(name)
        if not path.exists():
            continue
        text = path.read_text()
        assert "generated_at" not in text
