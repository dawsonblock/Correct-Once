import pytest

from effect_fabric.effect_registry import (
    CHRONO_COMPENSATE_KEY,
    EffectDefinition,
    EffectRegistryV2,
    McpToolIdentity,
    MutationClass,
    RegistryDecision,
    parse_chronomcp_compensation,
)
from effect_fabric.models import (
    EffectContract,
    IdempotencyContract,
    Predicate,
    ReversibilityClass,
)
from effect_fabric.provider_profiles import (
    IdempotencyMode,
    OutcomeResolutionMode,
    ProbeMissMeaning,
    ProviderEffectProfile,
)


def provider():
    return ProviderEffectProfile(
        profile_id="github",
        tool_pattern="github.*",
        idempotency_mode=IdempotencyMode.NATURAL_BUSINESS_KEY,
        resolution_mode=OutcomeResolutionMode.AUTHORITATIVE_PROBE,
        miss_meaning=ProbeMissMeaning.NOT_HAPPENED,
        can_auto_rearm_on_miss=True,
        authoritative_source="github issue read",
    )


def definition(schema=None):
    schema = schema or {
        "type": "object",
        "properties": {"label": {"type": "string"}},
    }
    mclass, rev, comp = parse_chronomcp_compensation(
        {
            "_meta": {
                CHRONO_COMPENSATE_KEY: {
                    "reversibility": "compensable",
                    "compensation": {
                        "toolName": "remove_label",
                        "parameterMapping": {"label": "$.input.label"},
                    },
                }
            }
        }
    )
    return EffectDefinition(
        operation="github.issue.add_label",
        mcp=McpToolIdentity(server="github", tool="add_label", input_schema=schema),
        mutation_class=mclass,
        executor="github",
        contract=EffectContract(
            resource="issue",
            verifier="github_issue",
            expected=[Predicate(path="labels", operator="contains", value="security")],
        ),
        idempotency=IdempotencyContract(
            mechanism="natural_resource",
            key="issue:security",
        ),
        reversibility=rev,
        provider_profile=provider(),
        compensation=comp,
    )


def test_chrono_readonly_import():
    tool = {
        "_meta": {
            CHRONO_COMPENSATE_KEY: {"reversibility": "readonly"},
        }
    }
    mclass, rev, comp = parse_chronomcp_compensation(tool)
    assert mclass is MutationClass.READ_ONLY
    assert rev.classification is ReversibilityClass.READ_ONLY
    assert comp is None


def test_chrono_irreversible_import():
    tool = {
        "_meta": {
            CHRONO_COMPENSATE_KEY: {"reversibility": "irreversible"},
        }
    }
    mclass, rev, comp = parse_chronomcp_compensation(tool)
    assert mclass is MutationClass.DESTRUCTIVE
    assert rev.classification is ReversibilityClass.IRREVERSIBLE
    assert comp is None


def test_compensation_mapping_must_be_deterministic():
    tool = {
        "_meta": {
            CHRONO_COMPENSATE_KEY: {
                "reversibility": "compensable",
                "compensation": {
                    "toolName": "undo",
                    "parameterMapping": {"x": "ask-the-llm"},
                },
            }
        }
    }
    with pytest.raises(ValueError):
        parse_chronomcp_compensation(tool)


def test_registry_routes_registered_mutation():
    registry = EffectRegistryV2()
    effect = definition()
    registry.register(effect)
    decision = registry.route(
        server="github",
        tool="add_label",
        input_schema=effect.mcp.input_schema,
    )
    assert decision is RegistryDecision.GOVERNED_EFFECT


def test_registry_fails_closed_on_schema_drift():
    registry = EffectRegistryV2()
    effect = definition()
    registry.register(effect)
    changed = {
        "type": "object",
        "properties": {"label": {"type": "integer"}},
    }
    decision = registry.route(
        server="github",
        tool="add_label",
        input_schema=changed,
    )
    assert decision is RegistryDecision.DENY_SCHEMA_DRIFT


def test_unknown_mutation_is_denied():
    registry = EffectRegistryV2()
    decision = registry.route(server="x", tool="delete_all", input_schema={})
    assert decision is RegistryDecision.DENY_UNKNOWN_MUTATION


def test_unknown_declared_read_only_can_fast_path():
    registry = EffectRegistryV2()
    decision = registry.route(
        server="x",
        tool="get_status",
        input_schema={},
        declared_read_only=True,
    )
    assert decision is RegistryDecision.PASSTHROUGH_READ


def test_duplicate_changed_definition_refused():
    registry = EffectRegistryV2()
    effect = definition()
    registry.register(effect)
    changed_schema = {
        "type": "object",
        "properties": {"x": {"type": "string"}},
    }
    with pytest.raises(ValueError):
        registry.register(definition(changed_schema))
