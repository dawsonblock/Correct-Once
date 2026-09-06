"""MCP-native effect registry and donor compatibility metadata."""
from __future__ import annotations

from enum import StrEnum
from typing import Any, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .canonical import digest_document
from .models import EffectContract, IdempotencyContract, ReversibilityClass, ReversibilitySpec
from .provider_profiles import ProviderEffectProfile

CHRONO_COMPENSATE_KEY = "dev.chronomcp/compensate"


class MutationClass(StrEnum):
    READ_ONLY = "read_only"
    MUTATING = "mutating"
    DESTRUCTIVE = "destructive"
    UNKNOWN = "unknown"


class CompensationMapping(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    tool_name: str
    parameter_mapping: dict[str, str] = Field(default_factory=dict)

    @model_validator(mode="after")
    def deterministic_paths_only(self) -> Self:
        for source in self.parameter_mapping.values():
            if not (source.startswith("$.input.") or source.startswith("$.output.")):
                raise ValueError("compensation mapping must use $.input.* or $.output.* paths")
        return self


class McpToolIdentity(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    server: str
    tool: str
    input_schema: dict[str, Any] = Field(default_factory=dict)

    @property
    def schema_digest(self) -> str:
        return digest_document(self.input_schema)


class EffectDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: str = "effect-fabric/effect-definition/v1"
    operation: str
    mcp: McpToolIdentity
    mutation_class: MutationClass
    executor: str
    contract: EffectContract
    idempotency: IdempotencyContract
    reversibility: ReversibilitySpec
    provider_profile: ProviderEffectProfile
    compensation: CompensationMapping | None = None
    exact_action_authorization: bool = True
    qualification_ids: tuple[str, ...] = ()

    @model_validator(mode="after")
    def consistent_reversibility(self) -> Self:
        if self.mutation_class is MutationClass.READ_ONLY:
            if self.reversibility.classification is not ReversibilityClass.READ_ONLY:
                raise ValueError("read-only MCP tools require read-only reversibility")
        if self.reversibility.classification is ReversibilityClass.COMPENSABLE:
            if self.compensation is None:
                raise ValueError("compensable effect requires deterministic compensation metadata")
        return self

    @property
    def digest(self) -> str:
        return digest_document(self.model_dump(mode="json"))

    def matches_tool(self, *, server: str, tool: str, input_schema: dict[str, Any]) -> bool:
        candidate = McpToolIdentity(server=server, tool=tool, input_schema=input_schema)
        return (
            candidate.server == self.mcp.server
            and candidate.tool == self.mcp.tool
            and candidate.schema_digest == self.mcp.schema_digest
        )


class RegistryDecision(StrEnum):
    PASSTHROUGH_READ = "passthrough_read"
    GOVERNED_EFFECT = "governed_effect"
    DENY_UNKNOWN_MUTATION = "deny_unknown_mutation"
    DENY_SCHEMA_DRIFT = "deny_schema_drift"


class EffectRegistryV2:
    def __init__(self) -> None:
        self._definitions: dict[tuple[str, str], EffectDefinition] = {}

    def register(self, definition: EffectDefinition) -> None:
        key = (definition.mcp.server, definition.mcp.tool)
        current = self._definitions.get(key)
        if current is not None and current.digest != definition.digest:
            raise ValueError(f"effect definition already registered with different digest: {key}")
        self._definitions[key] = definition

    def get(self, server: str, tool: str) -> EffectDefinition | None:
        return self._definitions.get((server, tool))

    def route(
        self,
        *,
        server: str,
        tool: str,
        input_schema: dict[str, Any],
        declared_read_only: bool = False,
    ) -> RegistryDecision:
        definition = self.get(server, tool)
        if definition is None:
            return (
                RegistryDecision.PASSTHROUGH_READ
                if declared_read_only
                else RegistryDecision.DENY_UNKNOWN_MUTATION
            )
        if definition.mcp.schema_digest != digest_document(input_schema):
            return RegistryDecision.DENY_SCHEMA_DRIFT
        if definition.mutation_class is MutationClass.READ_ONLY:
            return RegistryDecision.PASSTHROUGH_READ
        return RegistryDecision.GOVERNED_EFFECT


def parse_chronomcp_compensation(
    tool: dict[str, Any],
) -> tuple[MutationClass, ReversibilitySpec, CompensationMapping | None]:
    meta = tool.get("_meta") or {}
    ext = meta.get(CHRONO_COMPENSATE_KEY)
    if not isinstance(ext, dict):
        return (
            MutationClass.UNKNOWN,
            ReversibilitySpec(classification=ReversibilityClass.UNKNOWN),
            None,
        )
    reversibility = ext.get("reversibility")
    if reversibility == "readonly":
        return (
            MutationClass.READ_ONLY,
            ReversibilitySpec(classification=ReversibilityClass.READ_ONLY),
            None,
        )
    if reversibility == "irreversible":
        return (
            MutationClass.DESTRUCTIVE,
            ReversibilitySpec(classification=ReversibilityClass.IRREVERSIBLE),
            None,
        )
    if reversibility == "compensable":
        raw = ext.get("compensation")
        if not isinstance(raw, dict) or not isinstance(raw.get("toolName"), str):
            raise ValueError("ChronoMCP compensable tool requires compensation.toolName")
        mapping = CompensationMapping(
            tool_name=raw["toolName"],
            parameter_mapping=dict(raw.get("parameterMapping") or {}),
        )
        return (
            MutationClass.MUTATING,
            ReversibilitySpec(
                classification=ReversibilityClass.COMPENSABLE,
                recovery_operation=mapping.tool_name,
            ),
            mapping,
        )
    raise ValueError(f"unsupported ChronoMCP reversibility value: {reversibility!r}")
