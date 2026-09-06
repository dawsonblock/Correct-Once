# Release Qualification v0.2.12

v0.2.12 preserves the source-bound qualification model introduced in v0.2.7 and adds explicit
local workload-identity and external-anchor mechanism gates.

`QUALIFICATION_INPUTS.sha256` is generated from the non-generated source/input tree before stable
qualification artifacts are created. Every stable gate is then bound to the current qualification
input digest, package version, native reducer digest, donor lock digest, and pyproject digest.

## Local gates

The release pipeline generates or refreshes:

- `CORE_TEST_QUALIFICATION.json`;
- `PROVIDER_QUALIFICATION.json`;
- `EVIDENCE_QUALIFICATION.json`;
- `TRANSACTIONAL_EVIDENCE_QUALIFICATION.json`;
- `DONOR_COMPATIBILITY_QUALIFICATION.json`;
- `TRANSITION_KERNEL_QUALIFICATION.json`;
- `GATEWAY_QUALIFICATION.json`;
- `WORKLOAD_IDENTITY_QUALIFICATION.json`;
- `EXTERNAL_ANCHOR_QUALIFICATION.json`;
- reducer equivalence and negative controls;
- static qualification;
- PostgreSQL qualification;
- upstream DAO qualification/reproducibility records;
- qualification-artifact determinism.

The workload-identity local gate proves an authority-signed worker credential can be required before
execution, persisted on the attempt, and represented in signed start/outcome evidence. It does not
claim production KMS/HSM custody or hardware/service attestation.

The external-anchor local gate proves signed environment/release-bound checkpoints, append-only local
persistence, chain verification, and tamper detection. It does not claim WORM/Object-Lock semantics.

## Fail-closed NOT_RUN semantics

External prerequisites are never inferred. Without a DAO donor checkout, upstream reports are
rewritten as `NOT_RUN`. Without a live PostgreSQL environment, PostgreSQL qualification remains
`NOT_RUN`. Ruff/mypy remain `NOT_RUN` when their tools are unavailable. Live GitHub, production
workload identity, external WORM anchoring, and production kernel promotion remain separate gates.

`REFERENCE_QUALIFIED` means the available local/reference gates passed for this exact source tree.
It does not mean production-qualified.
