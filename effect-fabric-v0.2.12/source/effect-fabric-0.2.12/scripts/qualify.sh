#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${PYTHON:-python3}"
cd "$ROOT"
export PYTHONPATH="${ROOT}/src${PYTHONPATH:+:${PYTHONPATH}}"

"$PYTHON" scripts/build_qualification_inputs.py >/dev/null

JUNIT=.qualification-core-tests.xml
rm -f "$JUNIT"
"$PYTHON" -m pytest -ra --junitxml="$JUNIT"
"$PYTHON" scripts/write_core_test_gate.py --junit "$JUNIT" --output CORE_TEST_QUALIFICATION.json >/dev/null
rm -f "$JUNIT"

"$PYTHON" scripts/qualify_provider.py --output PROVIDER_QUALIFICATION.json >/dev/null
"$PYTHON" scripts/qualify_evidence.py --output EVIDENCE_QUALIFICATION.json >/dev/null
"$PYTHON" scripts/qualify_transactional_evidence.py --output TRANSACTIONAL_EVIDENCE_QUALIFICATION.json >/dev/null
"$PYTHON" scripts/qualify_donor_compatibility.py --output DONOR_COMPATIBILITY_QUALIFICATION.json >/dev/null
"$PYTHON" scripts/qualify_transition_kernel.py --output TRANSITION_KERNEL_QUALIFICATION.json >/dev/null
"$PYTHON" scripts/qualify_gateway.py --output GATEWAY_QUALIFICATION.json >/dev/null
"$PYTHON" scripts/qualify_workload_identity.py --output WORKLOAD_IDENTITY_QUALIFICATION.json >/dev/null
"$PYTHON" scripts/qualify_external_anchor.py --output EXTERNAL_ANCHOR_QUALIFICATION.json >/dev/null

UPSTREAM_REPORTS=(
  UPSTREAM_DAO_QUALIFICATION.json
  UPSTREAM_DAO_REPRODUCIBILITY.json
  UPSTREAM_DAO_DIRECT_STORE_QUALIFICATION.json
  UPSTREAM_DAO_DIRECT_STORE_REPRODUCIBILITY.json
  UPSTREAM_DAO_ENGINE_INTERFACE_QUALIFICATION.json
  UPSTREAM_DAO_ENGINE_INTERFACE_REPRODUCIBILITY.json
  UPSTREAM_DAO_ACTIVE_ENGINE_QUALIFICATION.json
  UPSTREAM_DAO_ACTIVE_ENGINE_REPRODUCIBILITY.json
  UPSTREAM_DAO_NATIVE_ENGINE_QUALIFICATION.json
  UPSTREAM_DAO_NATIVE_ENGINE_REPRODUCIBILITY.json
)

if [[ -n "${EFFECT_FABRIC_DAO_DONOR_ROOT:-}" ]]; then
  "$PYTHON" scripts/qualify_upstream_dao.py --donor-root "$EFFECT_FABRIC_DAO_DONOR_ROOT" --output UPSTREAM_DAO_QUALIFICATION.json >/dev/null
  "$PYTHON" scripts/verify_upstream_dao_reproducibility.py --donor-root "$EFFECT_FABRIC_DAO_DONOR_ROOT" --output UPSTREAM_DAO_REPRODUCIBILITY.json >/dev/null
  "$PYTHON" scripts/qualify_upstream_dao_store.py --donor-root "$EFFECT_FABRIC_DAO_DONOR_ROOT" --output UPSTREAM_DAO_DIRECT_STORE_QUALIFICATION.json >/dev/null
  "$PYTHON" scripts/verify_upstream_dao_store_reproducibility.py --donor-root "$EFFECT_FABRIC_DAO_DONOR_ROOT" --output UPSTREAM_DAO_DIRECT_STORE_REPRODUCIBILITY.json >/dev/null
  "$PYTHON" scripts/qualify_upstream_dao_engine.py --donor-root "$EFFECT_FABRIC_DAO_DONOR_ROOT" --output UPSTREAM_DAO_ENGINE_INTERFACE_QUALIFICATION.json >/dev/null
  "$PYTHON" scripts/verify_upstream_dao_engine_reproducibility.py --donor-root "$EFFECT_FABRIC_DAO_DONOR_ROOT" --output UPSTREAM_DAO_ENGINE_INTERFACE_REPRODUCIBILITY.json >/dev/null
  "$PYTHON" scripts/qualify_upstream_dao_active_engine.py --donor-root "$EFFECT_FABRIC_DAO_DONOR_ROOT" --output UPSTREAM_DAO_ACTIVE_ENGINE_QUALIFICATION.json >/dev/null
  "$PYTHON" scripts/verify_upstream_dao_active_engine_reproducibility.py --donor-root "$EFFECT_FABRIC_DAO_DONOR_ROOT" --output UPSTREAM_DAO_ACTIVE_ENGINE_REPRODUCIBILITY.json >/dev/null
  "$PYTHON" scripts/qualify_upstream_dao_native_engine.py --donor-root "$EFFECT_FABRIC_DAO_DONOR_ROOT" --output UPSTREAM_DAO_NATIVE_ENGINE_QUALIFICATION.json >/dev/null
  "$PYTHON" scripts/verify_upstream_dao_native_engine_reproducibility.py --donor-root "$EFFECT_FABRIC_DAO_DONOR_ROOT" --output UPSTREAM_DAO_NATIVE_ENGINE_REPRODUCIBILITY.json >/dev/null
else
  MARK_ARGS=()
  for report in "${UPSTREAM_REPORTS[@]}"; do
    MARK_ARGS+=(--output "$report")
  done
  "$PYTHON" scripts/mark_gate_not_run.py \
    "${MARK_ARGS[@]}" \
    --reason "EFFECT_FABRIC_DAO_DONOR_ROOT was not supplied for this qualification run" >/dev/null
fi

"$PYTHON" scripts/qualify_reducer_equivalence.py --output REDUCER_EQUIVALENCE_QUALIFICATION.json >/dev/null
"$PYTHON" scripts/qualify_negative_controls.py --output REDUCER_NEGATIVE_CONTROL_QUALIFICATION.json >/dev/null
"$PYTHON" scripts/local_static_sanity.py > LOCAL_STATIC_SANITY.json
"$PYTHON" scripts/qualify_static.py --allow-not-run --output STATIC_QUALIFICATION.json >/dev/null
"$PYTHON" scripts/qualify_postgres.py --allow-not-run --output POSTGRES_QUALIFICATION.json >/dev/null
"$PYTHON" scripts/verify_qualification_reproducibility.py > QUALIFICATION_REPRODUCIBILITY.json

# Bind every stable gate to the exact qualification-input tree. This is intentionally done before
# release-status aggregation so stale or copied reports fail closed.
"$PYTHON" scripts/bind_qualification_evidence.py >/dev/null
"$PYTHON" scripts/generate_release_status.py >/dev/null
"$PYTHON" scripts/capture_run_metadata.py --output QUALIFICATION_RUN.json
"$PYTHON" -m effect_fabric.cli demo
