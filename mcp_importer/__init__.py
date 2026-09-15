"""Fail-closed MCP importer scaffold for Correct-Once.

This package is intentionally narrow: it discovers MCP tool descriptors,
normalizes them, classifies them using explicit evidence, and keeps unknown
tools denied until a reviewer admits them.
"""

from .admission import AdmissionDecision, admit_tool
from .classifier import ClassificationResult, classify_tool
from .importer import ImportReport, import_tools
from .normalize import NormalizedMcpTool, ToolAnnotations, normalize_tool

__all__ = [
    "AdmissionDecision",
    "ClassificationResult",
    "ImportReport",
    "NormalizedMcpTool",
    "ToolAnnotations",
    "admit_tool",
    "classify_tool",
    "import_tools",
    "normalize_tool",
]
