import pytest

from effect_fabric.qualification.reducer_equivalence import run_runtime_equivalence


@pytest.mark.asyncio
async def test_active_runtime_and_pure_reducer_match_common_execution_traces():
    results = await run_runtime_equivalence()
    assert len(results) >= 9
    failures = [result for result in results if not result.passed]
    assert failures == []
