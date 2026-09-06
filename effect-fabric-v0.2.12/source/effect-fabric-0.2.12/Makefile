PYTHON ?= python3

.PHONY: test static qualify provider evidence transactional-evidence reducer-equivalence negative-controls upstream-dao upstream-dao-store upstream-dao-active demo release

test:
	PYTHONPATH=src $(PYTHON) -m pytest -ra

static:
	ruff check .
	mypy src

qualify:
	./scripts/qualify.sh

provider:
	PYTHONPATH=src $(PYTHON) scripts/qualify_provider.py --output PROVIDER_QUALIFICATION.json

evidence:
	PYTHONPATH=src $(PYTHON) scripts/qualify_evidence.py

transactional-evidence:
	PYTHONPATH=src $(PYTHON) scripts/qualify_transactional_evidence.py > TRANSACTIONAL_EVIDENCE_QUALIFICATION.json

reducer-equivalence:
	PYTHONPATH=src $(PYTHON) scripts/qualify_reducer_equivalence.py

negative-controls:
	PYTHONPATH=src $(PYTHON) scripts/qualify_negative_controls.py

upstream-dao:
	@test -n "$$EFFECT_FABRIC_DAO_DONOR_ROOT" || (echo "set EFFECT_FABRIC_DAO_DONOR_ROOT" && exit 2)
	PYTHONPATH=src $(PYTHON) scripts/qualify_upstream_dao.py --donor-root "$$EFFECT_FABRIC_DAO_DONOR_ROOT"

upstream-dao-store:
	@test -n "$$EFFECT_FABRIC_DAO_DONOR_ROOT" || (echo "set EFFECT_FABRIC_DAO_DONOR_ROOT" && exit 2)
	PYTHONPATH=src $(PYTHON) scripts/qualify_upstream_dao_store.py --donor-root "$$EFFECT_FABRIC_DAO_DONOR_ROOT"

upstream-dao-active:
	@test -n "$$EFFECT_FABRIC_DAO_DONOR_ROOT" || (echo "set EFFECT_FABRIC_DAO_DONOR_ROOT" && exit 2)
	PYTHONPATH=src $(PYTHON) scripts/qualify_upstream_dao_active_engine.py --donor-root "$$EFFECT_FABRIC_DAO_DONOR_ROOT"

demo:
	PYTHONPATH=src $(PYTHON) -m effect_fabric.cli demo

release:
	PYTHONPATH=src $(PYTHON) scripts/build_release.py
