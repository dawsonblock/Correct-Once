PYTHON ?= python3
NPM ?= npm

EFFECT_FABRIC_DIR := effect-fabric-v0.2.11/source/effect-fabric-0.2.11
FUNCTION_HOOKS_DIR := function-hooks-core-reference-v0.11.0

.PHONY: install install-a install-b build-b smoke smoke-a-import smoke-b-import

install: install-a install-b

install-a:
	$(PYTHON) -m pip install -e $(EFFECT_FABRIC_DIR)

install-b:
	cd $(FUNCTION_HOOKS_DIR) && $(NPM) install --package-lock=false

build-b:
	cd $(FUNCTION_HOOKS_DIR) && $(NPM) run build

smoke:
	$(PYTHON) adapter/fixtures/run_smoke.py

smoke-a-import:
	$(PYTHON) -c "from effect_fabric.gateway import EffectGateway; print('effect-fabric import OK:', EffectGateway.__module__)"

smoke-b-import:
	cd $(FUNCTION_HOOKS_DIR) && node --input-type=module -e "import('@function-hooks/gateway').then(() => console.log('function-hooks gateway import OK')).catch((err) => { console.error(err); process.exit(1); })"
