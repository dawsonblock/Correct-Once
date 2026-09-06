#!/usr/bin/env python3
from __future__ import annotations

import ast
import json
from pathlib import Path

ROOTS = (Path("src"), Path("tests"), Path("scripts"))


def main() -> int:
    findings: list[dict[str, object]] = []
    for root in ROOTS:
        for path in sorted(root.rglob("*.py")):
            text = path.read_text()
            try:
                tree = ast.parse(text)
            except SyntaxError as exc:
                findings.append({"file": str(path), "line": exc.lineno, "kind": "syntax"})
                continue
            for number, line in enumerate(text.splitlines(), start=1):
                if len(line) > 100:
                    findings.append(
                        {
                            "file": str(path),
                            "line": number,
                            "kind": "line_length",
                            "length": len(line),
                        }
                    )
                if line.rstrip() != line:
                    findings.append(
                        {"file": str(path), "line": number, "kind": "trailing_whitespace"}
                    )
            if path.name == "__init__.py":
                continue
            used = {node.id for node in ast.walk(tree) if isinstance(node, ast.Name)}
            imports: list[tuple[str, int]] = []
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    imports.extend(
                        (alias.asname or alias.name.split(".")[0], node.lineno)
                        for alias in node.names
                    )
                elif isinstance(node, ast.ImportFrom):
                    imports.extend(
                        (alias.asname or alias.name, node.lineno)
                        for alias in node.names
                        if alias.name != "*"
                    )
            for name, line in imports:
                if name not in used and name != "annotations":
                    findings.append(
                        {
                            "file": str(path),
                            "line": line,
                            "kind": "unused_import_like",
                            "name": name,
                        }
                    )
    result = {"status": "PASS" if not findings else "FAIL", "findings": findings}
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if not findings else 1


if __name__ == "__main__":
    raise SystemExit(main())
