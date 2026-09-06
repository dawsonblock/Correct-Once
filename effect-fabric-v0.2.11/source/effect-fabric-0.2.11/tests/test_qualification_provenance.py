from __future__ import annotations

import json
from pathlib import Path

from effect_fabric.qualification.provenance import (
    bind_document,
    provenance_failures,
    qualification_inputs_sha256,
    write_input_manifest,
)


def make_tree(root: Path) -> None:
    (root / "src").mkdir()
    (root / "src" / "runtime.py").write_text("VALUE = 1\n")
    bridge = root / "bridges" / "durable-agent-outbox"
    bridge.mkdir(parents=True)
    (bridge / "effect_fabric_native_reduce.ts").write_text("export const VERSION = 1;\n")
    (root / "DONOR_LOCK.json").write_text('{"lock": 1}\n')
    (root / "pyproject.toml").write_text('[project]\nname="effect-fabric"\n')


def test_bound_evidence_is_invalidated_by_source_mutation(tmp_path: Path) -> None:
    make_tree(tmp_path)
    write_input_manifest(tmp_path)
    bound = bind_document({"status": "PASS"}, tmp_path)
    assert provenance_failures(bound, tmp_path) == []

    (tmp_path / "src" / "runtime.py").write_text("VALUE = 2\n")
    failures = provenance_failures(bound, tmp_path)
    assert "stale:QUALIFICATION_INPUTS.sha256" in failures
    assert any("qualification_inputs_sha256" in item for item in failures)


def test_generated_qualification_json_is_not_an_input_to_its_own_digest(tmp_path: Path) -> None:
    make_tree(tmp_path)
    write_input_manifest(tmp_path)
    before = qualification_inputs_sha256(tmp_path)
    report = bind_document({"status": "PASS"}, tmp_path)
    (tmp_path / "SOME_QUALIFICATION.json").write_text(json.dumps(report))
    after = qualification_inputs_sha256(tmp_path)
    assert after == before


def test_native_kernel_mutation_breaks_explicit_provenance_binding(tmp_path: Path) -> None:
    make_tree(tmp_path)
    write_input_manifest(tmp_path)
    bound = bind_document({"status": "PASS"}, tmp_path)
    native = tmp_path / "bridges" / "durable-agent-outbox" / "effect_fabric_native_reduce.ts"
    native.write_text("export const VERSION = 2;\n")
    failures = provenance_failures(bound, tmp_path)
    assert any("native_reducer_sha256" in item for item in failures)
