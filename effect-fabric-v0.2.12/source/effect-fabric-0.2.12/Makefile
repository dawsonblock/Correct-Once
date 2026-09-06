.PHONY: test static qualify provider evidence transactional-evidence reducer-equivalence negative-controls upstream-dao upstream-dao-store upstream-dao-active demo release

test:
	PYTHONPATH=src pytest -ra

static:
	ruff check .
	mypy src

qualify:
	./scripts/qualify.sh

provider:
	PYTHONPATH=src python scripts/qualify_provider.py --output PROVIDER_QUALIFICATION.json

evidence:
	PYTHONPATH=src python scripts/qualify_evidence.py

transactional-evidence:
	PYTHONPATH=src python scripts/qualify_transactional_evidence.py > TRANSACTIONAL_EVIDENCE_QUALIFICATION.json

reducer-equivalence:
	PYTHONPATH=src python scripts/qualify_reducer_equivalence.py

negative-controls:
	PYTHONPATH=src python scripts/qualify_negative_controls.py

upstream-dao:
	@test -n "$$EFFECT_FABRIC_DAO_DONOR_ROOT" || (echo "set EFFECT_FABRIC_DAO_DONOR_ROOT" && exit 2)
	PYTHONPATH=src python scripts/qualify_upstream_dao.py --donor-root "$$EFFECT_FABRIC_DAO_DONOR_ROOT"

upstream-dao-store:
	@test -n "$$EFFECT_FABRIC_DAO_DONOR_ROOT" || (echo "set EFFECT_FABRIC_DAO_DONOR_ROOT" && exit 2)
	PYTHONPATH=src python scripts/qualify_upstream_dao_store.py --donor-root "$$EFFECT_FABRIC_DAO_DONOR_ROOT"

upstream-dao-active:
	@test -n "$$EFFECT_FABRIC_DAO_DONOR_ROOT" || (echo "set EFFECT_FABRIC_DAO_DONOR_ROOT" && exit 2)
	PYTHONPATH=src python scripts/qualify_upstream_dao_active_engine.py --donor-root "$$EFFECT_FABRIC_DAO_DONOR_ROOT"

demo:
	PYTHONPATH=src python -m effect_fabric.cli demo

release:
	PYTHONPATH=src python scripts/build_release.py
