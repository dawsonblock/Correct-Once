from __future__ import annotations

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src" / "effect_fabric"


def _is_execution_state_target(node: ast.expr) -> bool:
    return isinstance(node, ast.Attribute) and node.attr == "execution_state"


def test_runtime_execution_state_writes_are_centralized_in_kernel() -> None:
    offenders: list[str] = []
    for path in sorted(SRC.rglob("*.py")):
        if path.name == "transition_kernel.py":
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            targets: list[ast.expr] = []
            if isinstance(node, ast.Assign):
                targets = list(node.targets)
            elif isinstance(node, ast.AnnAssign):
                targets = [node.target]
            elif isinstance(node, ast.AugAssign):
                targets = [node.target]
            if any(_is_execution_state_target(target) for target in targets):
                offenders.append(f"{path.relative_to(ROOT)}:{node.lineno}")
    assert offenders == []
