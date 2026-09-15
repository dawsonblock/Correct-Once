from __future__ import annotations

from mcp_importer.classifier import classify_tool
from mcp_importer.importer import import_tools
from mcp_importer.normalize import normalize_tool


def tool(
    name: str,
    description: str,
    *,
    annotations: dict[str, object] | None = None,
    verified_read_only: bool = False,
):
    return normalize_tool(
        "github",
        {
            "name": name,
            "description": description,
            "inputSchema": {"type": "object"},
            "annotations": annotations or {},
        },
        verified_read_only=verified_read_only,
    )


def test_verified_read_only_requires_independent_verification() -> None:
    hinted_only = classify_tool(
        tool(
            "repo.read",
            "Read repository metadata",
            annotations={"readOnlyHint": True},
        )
    )
    assert hinted_only.admitted is False
    assert hinted_only.execution_class is None

    verified = classify_tool(
        tool(
            "repo.read",
            "Read repository metadata",
            annotations={"readOnlyHint": True},
            verified_read_only=True,
        )
    )
    assert verified.admitted is True
    assert verified.execution_class == "read"


def test_destructive_tools_map_to_critical() -> None:
    result = classify_tool(
        tool(
            "repo.delete",
            "Delete repository data permanently",
            annotations={"destructiveHint": True},
        )
    )
    assert result.admitted is True
    assert result.execution_class == "critical"


def test_high_risk_mutations_map_to_critical() -> None:
    result = classify_tool(
        tool(
            "repo.settings.update",
            "Update repository settings and policy bindings",
            annotations={"readOnlyHint": False},
        )
    )
    assert result.admitted is True
    assert result.execution_class == "critical"


def test_ordinary_mutations_map_to_mutation() -> None:
    result = classify_tool(
        tool(
            "repo.label.update",
            "Update repository labels",
            annotations={"readOnlyHint": False},
        )
    )
    assert result.admitted is True
    assert result.execution_class == "mutation"


def test_unknown_tools_stay_denied() -> None:
    result = classify_tool(
        tool(
            "repo.inspect",
            "Inspect repository state",
        )
    )
    assert result.admitted is False
    assert result.execution_class is None


def test_import_report_splits_admitted_and_denied() -> None:
    report = import_tools(
        [
            tool(
                "repo.read",
                "Read repository metadata",
                annotations={"readOnlyHint": True},
                verified_read_only=True,
            ),
            tool("repo.inspect", "Inspect repository state"),
        ]
    )
    assert [decision.capability_id for decision in report.admitted] == [
        "github.repo.read"
    ]
    assert [decision.capability_id for decision in report.denied] == [
        "github.repo.inspect"
    ]
