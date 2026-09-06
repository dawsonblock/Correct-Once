PYTHON ?= python3
NPM ?= npm

EFFECT_FABRIC_DIR := effect-fabric-v0.2.12/source/effect-fabric-0.2.12
FUNCTION_HOOKS_DIR := function-hooks-core-reference-v0.11.0
FUNCTION_HOOKS_RUNTIME_DIR := function-hooks-runtime-v0.12
QUALIFY_PYTHONPATH := $(CURDIR):$(CURDIR)/$(EFFECT_FABRIC_DIR)/src
QUALIFY_WHEEL_VENV := $(CURDIR)/.tmp/effect-fabric-wheel-qualify

.PHONY: install install-a install-b install-runtime build-a-release build-b typecheck typecheck-runtime verify-a-integrity test test-runtime test-adapter-live test-cross-language verify-b-manifest qualify smoke smoke-runtime smoke-adapter smoke-a-import smoke-b-import

install: install-a install-b install-runtime

install-a:
	$(PYTHON) -m pip install -e "$(CURDIR)/$(EFFECT_FABRIC_DIR)[api,dev]"

install-b:
	cd $(FUNCTION_HOOKS_DIR) && $(NPM) ci

install-runtime:
	cd $(FUNCTION_HOOKS_RUNTIME_DIR) && $(NPM) ci

build-a-release:
	cd $(EFFECT_FABRIC_DIR) && bash scripts/qualify.sh && $(PYTHON) scripts/freeze_release.py && $(PYTHON) scripts/verify_release_integrity.py && $(PYTHON) scripts/build_release.py

build-b:
	cd $(FUNCTION_HOOKS_DIR) && $(NPM) run build

typecheck: typecheck-runtime

typecheck-runtime:
	cd $(FUNCTION_HOOKS_RUNTIME_DIR) && $(NPM) run typecheck && $(NPM) run typecheck:qualification

verify-a-integrity:
	cd $(EFFECT_FABRIC_DIR) && $(PYTHON) scripts/verify_release_integrity.py

test: test-runtime

test-runtime:
	cd $(FUNCTION_HOOKS_RUNTIME_DIR) && $(NPM) test

test-adapter-live:
	PYTHONPATH="$(QUALIFY_PYTHONPATH)" $(PYTHON) -m pytest -q adapter/tests/test_curated_mcp_adapter_live.py adapter/tests/test_write_identity_vectors.py

test-cross-language: build-a-release
	set -- "$(EFFECT_FABRIC_DIR)"/release-artifacts/wheel/effect_fabric-0.2.12-*.whl && \
	[ "$$#" -eq 1 ] && [ -f "$$1" ] || (echo "expected exactly one 0.2.12 wheel, found $$#" >&2; exit 1) && \
	WHEEL_PATH="$$(realpath "$$1")" && \
	rm -rf "$(QUALIFY_WHEEL_VENV)" && \
	($(PYTHON) -m venv "$(QUALIFY_WHEEL_VENV)" >/dev/null 2>&1 || $(PYTHON) -m virtualenv "$(QUALIFY_WHEEL_VENV)") && \
	"$(QUALIFY_WHEEL_VENV)/bin/python" -m pip install --upgrade pip && \
	"$(QUALIFY_WHEEL_VENV)/bin/pip" install "effect-fabric[api] @ file://$$WHEEL_PATH" && \
	cd $(FUNCTION_HOOKS_RUNTIME_DIR) && \
	EFFECT_FABRIC_TEST_PYTHON="$(QUALIFY_WHEEL_VENV)/bin/python" EFFECT_FABRIC_EXPECT_WHEEL=1 $(NPM) run test:cross-language

verify-b-manifest:
	cd $(FUNCTION_HOOKS_DIR) && sha256sum --check MANIFEST.sha256

qualify:
	$(MAKE) build-a-release
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
