import pytest

from effect_fabric.provider_profiles import (
    IdempotencyMode,
    OutcomeResolutionMode,
    ProbeMissMeaning,
    ProviderEffectProfile,
)


def profile(**overrides):
    base = dict(
        profile_id="github-pr",
        tool_pattern="github.create_pr",
        idempotency_mode=IdempotencyMode.NATURAL_BUSINESS_KEY,
        resolution_mode=OutcomeResolutionMode.AUTHORITATIVE_PROBE,
        miss_meaning=ProbeMissMeaning.NOT_HAPPENED,
        can_auto_rearm_on_miss=True,
        stable_key_fields=("owner", "repo", "head"),
        authoritative_source="GitHub primary repository API",
    )
    base.update(overrides)
    return ProviderEffectProfile(**base)


def test_authoritative_profile_may_rearm():
    assert profile().permits_retry_after_miss()


def test_one_sided_miss_cannot_mean_not_happened():
    with pytest.raises(ValueError):
        profile(
            resolution_mode=OutcomeResolutionMode.ONE_SIDED_PROBE,
            miss_meaning=ProbeMissMeaning.NOT_HAPPENED,
            can_auto_rearm_on_miss=False,
        )


def test_one_sided_miss_cannot_rearm():
    with pytest.raises(ValueError):
        profile(
            resolution_mode=OutcomeResolutionMode.ONE_SIDED_PROBE,
            miss_meaning=ProbeMissMeaning.INCONCLUSIVE,
            can_auto_rearm_on_miss=True,
        )


def test_no_resolver_cannot_rearm():
    with pytest.raises(ValueError):
        profile(
            resolution_mode=OutcomeResolutionMode.NONE,
            miss_meaning=ProbeMissMeaning.INCONCLUSIVE,
            can_auto_rearm_on_miss=True,
        )


def test_profile_digest_is_stable():
    assert profile().digest == profile().digest
