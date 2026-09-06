from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NATIVE = ROOT / "bridges" / "durable-agent-outbox" / "effect_fabric_native_reduce.ts"
RUNNER = ROOT / "bridges" / "durable-agent-outbox" / "run_effect_fabric_native_engine.mjs"
QUALIFIER = ROOT / "scripts" / "qualify_upstream_dao_native_engine.py"


def test_native_transition_kernel_is_checked_in_and_versioned() -> None:
    source = NATIVE.read_text()
    assert 'EFFECT_FABRIC_NATIVE_KERNEL_VERSION = "0.2.12"' in source
    assert "EFFECT_FABRIC_NATIVE_REDUCER_METRICS.calls += 1" in source
    assert "export function reduce(" in source


def test_native_runner_declares_no_donor_reduce_delegation() -> None:
    source = RUNNER.read_text()
    assert 'transition_oracle: "effect_fabric_native_reduce.ts"' in source
    assert "donor_reduce_delegated: false" in source
    assert "EFFECT_FABRIC_NATIVE_REDUCER_METRICS.calls" in source


def test_native_qualifier_redirects_worker_and_poisons_donor_reduce() -> None:
    source = QUALIFIER.read_text()
    assert 'from "./effectFabricNativeReduce.js";' in source
    assert "DONOR_REDUCE_POISONED_BY_EFFECT_FABRIC_V0_2_9" in source
    assert "donor_reduce_poisoned" in source


def test_native_kernel_rejects_wrong_worker_attempt_results_and_stale_ack_epochs() -> None:
    source = NATIVE.read_text()
    assert "a.epoch !== command.epoch || a.owner !== command.worker" in source
    assert "active owner is" in source
    assert 'case "ACK"' in source
    assert "a.epoch !== command.epoch" in source
    assert "ack worker must be non-empty" in source


def test_native_kernel_rejects_non_newer_pending_withdrawal_epochs() -> None:
    source = NATIVE.read_text()
    assert "epoch <= a.pendingWithdrawal.epoch" in source
    assert "withdrawal epoch" in source
