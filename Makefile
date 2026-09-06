PYTHON ?= python3
NPM ?= npm

EFFECT_FABRIC_DIR := effect-fabric-v0.2.11/source/effect-fabric-0.2.11
FUNCTION_HOOKS_DIR := function-hooks-core-reference-v0.11.0
FUNCTION_HOOKS_RUNTIME_DIR := function-hooks-runtime-v0.12
QUALIFY_PYTHONPATH := $(CURDIR):$(CURDIR)/$(EFFECT_FABRIC_DIR)/src

.PHONY: install install-a install-b install-runtime build-b typecheck typecheck-runtime test test-runtime test-adapter-live test-cross-language verify-b-manifest qualify smoke smoke-runtime smoke-adapter smoke-a-import smoke-b-import

install: install-a install-b install-runtime

install-a:
	$(PYTHON) -m pip install -e "$(CURDIR)/$(EFFECT_FABRIC_DIR)[api,dev]"

install-b:
	cd $(FUNCTION_HOOKS_DIR) && $(NPM) ci

install-runtime:
	cd $(FUNCTION_HOOKS_RUNTIME_DIR) && $(NPM) ci

build-b:
	cd $(FUNCTION_HOOKS_DIR) && $(NPM) run build

typecheck: typecheck-runtime

typecheck-runtime:
	cd $(FUNCTION_HOOKS_RUNTIME_DIR) && $(NPM) run typecheck

test: test-runtime

test-runtime:
	cd $(FUNCTION_HOOKS_RUNTIME_DIR) && $(NPM) test

test-adapter-live:
	PYTHONPATH="$(QUALIFY_PYTHONPATH)" $(PYTHON) -m pytest -q adapter/tests/test_curated_mcp_adapter_live.py

test-cross-language:
	cd $(FUNCTION_HOOKS_RUNTIME_DIR) && $(NPM) run test:cross-language

verify-b-manifest:
	cd $(FUNCTION_HOOKS_DIR) && sha256sum --check MANIFEST.sha256

qualify:
	$(MAKE) build-b
	$(MAKE) typecheck-runtime
	$(MAKE) test-runtime
	$(MAKE) test-adapter-live
	$(MAKE) test-cross-language
	$(MAKE) verify-b-manifest

smoke:
	$(MAKE) smoke-runtime
	$(MAKE) smoke-adapter

smoke-runtime:
	cd $(FUNCTION_HOOKS_RUNTIME_DIR) && $(NPM) test

smoke-adapter:
	$(PYTHON) adapter/fixtures/run_smoke.py

smoke-a-import:
	$(PYTHON) -c "from effect_fabric.gateway import EffectGateway; print('effect-fabric import OK:', EffectGateway.__module__)"

smoke-b-import:
	cd $(FUNCTION_HOOKS_DIR) && node --input-type=module -e "import('@function-hooks/gateway').then(() => console.log('function-hooks gateway import OK')).catch((err) => { console.error(err); process.exit(1); })"
