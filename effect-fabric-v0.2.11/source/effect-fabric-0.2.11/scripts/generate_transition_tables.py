#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import pprint
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / "spec" / "effect-transition-v1.json"
PY_OUT = ROOT / "src" / "effect_fabric" / "_generated_transition_table.py"
TS_OUT = ROOT / "bridges" / "durable-agent-outbox" / "generated_transition_table.ts"


def load_spec() -> dict[str, Any]:
    doc = json.loads(SPEC.read_text(encoding="utf-8"))
    if doc.get("schema") != "effect-fabric/transition-spec/v1":
        raise SystemExit("unexpected transition spec schema")
    states = doc.get("states")
    commands = doc.get("commands")
    if not isinstance(states, dict) or not states:
        raise SystemExit("transition spec requires states")
    if not isinstance(commands, dict) or not commands:
        raise SystemExit("transition spec requires commands")
    for name, command in commands.items():
        sources = command.get("sources")
        target = command.get("target")
        if not isinstance(sources, list) or not sources:
            raise SystemExit(f"command {name} requires non-empty sources")
        idempotent_sources = command.get("idempotent_sources", [])
        if not isinstance(idempotent_sources, list):
            raise SystemExit(f"command {name} idempotent_sources must be a list")
        referenced = [*sources, *idempotent_sources, target]
        unknown = [state for state in referenced if state not in states]
        if unknown:
            raise SystemExit(f"command {name} references unknown states: {unknown}")
        if states[target]["terminal"] and name.endswith("_retry"):
            raise SystemExit("retry transition target cannot be terminal")
    return doc


def spec_sha256() -> str:
    return hashlib.sha256(SPEC.read_bytes()).hexdigest()


def _pretty(value: Any) -> str:
    return pprint.pformat(value, width=88, sort_dicts=False)


def render_python(doc: dict[str, Any]) -> str:
    states = doc["states"]
    commands = doc["commands"]
    legal_edges = sorted(
        {
            (source, command["target"])
            for command in commands.values()
            for source in command["sources"]
        }
    )
    payload = {
        name: {
            "sources": tuple(command["sources"]),
            "target": command["target"],
            "requested_effects": tuple(command["requested_effects"]),
            "idempotent_sources": tuple(command.get("idempotent_sources", [])),
        }
        for name, command in commands.items()
    }
    terminal = tuple(name for name, meta in states.items() if meta["terminal"])
    ambiguous = tuple(name for name, meta in states.items() if meta["ambiguous"])
    parts = [
        '"""Generated from spec/effect-transition-v1.json. DO NOT EDIT BY HAND."""',
        "from __future__ import annotations",
        "",
        f'SPEC_SHA256 = "{spec_sha256()}"',
        f"EXECUTION_STATES = {_pretty(tuple(states))}",
        f"TERMINAL_STATES = frozenset({_pretty(terminal)})",
        f"AMBIGUOUS_STATES = frozenset({_pretty(ambiguous)})",
        f"LEGAL_EDGES = frozenset({_pretty(tuple(legal_edges))})",
        f"COMMANDS = {_pretty(payload)}",
        "",
    ]
    return "\n".join(parts)


def ts_value(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"))


def render_typescript(doc: dict[str, Any]) -> str:
    states = doc["states"]
    commands = doc["commands"]
    legal_edges = sorted(
        {
            f"{source}->{command['target']}"
            for command in commands.values()
            for source in command["sources"]
        }
    )
    command_payload = {
        name: {
            "sources": command["sources"],
            "target": command["target"],
            "requestedEffects": command["requested_effects"],
            "idempotentSources": command.get("idempotent_sources", []),
        }
        for name, command in commands.items()
    }
    terminal = [name for name, meta in states.items() if meta["terminal"]]
    return "\n".join(
        [
            "// Generated from spec/effect-transition-v1.json. DO NOT EDIT BY HAND.",
            (
                'export const EFFECT_FABRIC_TRANSITION_SPEC_SHA256 = '
                f'"{spec_sha256()}" as const;'
            ),
            (
                "export const EFFECT_FABRIC_EXECUTION_STATES = "
                f"{ts_value(list(states))} as const;"
            ),
            (
                "export const EFFECT_FABRIC_TERMINAL_STATES = "
                f"{ts_value(terminal)} as const;"
            ),
            (
                "export const EFFECT_FABRIC_LEGAL_EDGES = "
                f"{ts_value(legal_edges)} as const;"
            ),
            (
                "export const EFFECT_FABRIC_COMMANDS = "
                f"{ts_value(command_payload)} as const;"
            ),
            "",
        ]
    )


def summary(paths: dict[Path, str]) -> dict[str, object]:
    return {
        "status": "PASS",
        "spec_sha256": spec_sha256(),
        "generated_files": [str(path.relative_to(ROOT)) for path in paths],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    doc = load_spec()
    expected = {PY_OUT: render_python(doc), TS_OUT: render_typescript(doc)}
    if args.check:
        stale = [
            path
            for path, content in expected.items()
            if not path.is_file() or path.read_text(encoding="utf-8") != content
        ]
        if stale:
            relative = ", ".join(str(path.relative_to(ROOT)) for path in stale)
            print("stale generated transition tables:", relative)
            return 1
        print(json.dumps(summary(expected), indent=2))
        return 0
    for path, content in expected.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    print(json.dumps(summary(expected), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
