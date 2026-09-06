# Threat Model — v0.3.0

> Historical baseline: this document describes the v0.3-era design. The current distribution is v0.11.0; current gateway/release evidence is in `AGENT_GATEWAY.md`, `QUALIFICATION.md`, and `BUILD_REPORT.md`.


## Assets

Filesystem data, network endpoints, model credentials, terminal/tool authority, device adapters, plugin configuration/order, UI interactions, action receipts, audit evidence, and runtime generations.

## Trust domains

### Bootstrap-trusted host

Runtime implementation, core adapters, managed config verifier, key custody, trusted `engine.create` plugins, and selected isolation provider.

### Admitted isolated plugins

Potentially malicious. They receive only immutable event data, continuation RPC, and explicitly granted `$` capabilities.

### External systems

Filesystems, APIs, shells, browsers, models, and devices may have independent failure/duplicate semantics.

## Primary threats and v0.3 mitigations

| Threat | Mitigation |
| --- | --- |
| Ambient policy bypass | process/container isolation + restrictive imports + `$` RPC |
| Capability overreach | deny-by-default child proxy + host-side grant enforcement |
| Order manipulation | sealed managed order + deterministic resolver |
| Package substitution | exact package digest admission |
| Event smuggling | schema validation on root and every forwarded event |
| Duplicate side effects in one dispatch | non-idempotent `next()` multiplicity cap |
| Duplicate retry across dispatches | durable action IDs + completed/indeterminate receipts |
| Resource exhaustion | deadlines, frame/input/result limits, process memory limit, kill-on-timeout, optional container cgroups |
| Identity spoofing | host/session-bound origin |
| Audit tampering | hash chain, optional HMAC, durable recovery verification |
| Secret leakage into evidence | recursive redaction before persistence |
| Hook path/import escape | lexical + realpath confinement and restrictive loader |
| Unsafe live update | candidate generation + health gate + atomic publication + lease drain |
| Schema drift | semantic version registry + explicit migration paths |
| Policy regression | deterministic replay under pure/mock adapters |

## Residual risks

- host/runtime/isolation-provider vulnerabilities;
- incomplete OS sandbox deployment configuration;
- external systems that cannot be queried to resolve indeterminate actions;
- malicious trusted bootstrap plugins;
- distributed split-brain/partition behavior, which is not implemented here.
