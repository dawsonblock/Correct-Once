# Thin host example

This host stays intentionally small:

- `InMemoryRuntimeCapabilityRegistry`
- `createFunctionHooksRuntime(...)`
- `searchCapabilities(...)`
- `invokeCapability(...)`
- `createEffectGatewayClient(...)` for the optional critical path

It registers four demo capabilities:

- `demo.text.uppercase` — `PURE`
- `demo.file.read-note` — `READ`
- `demo.state.write` — `MUTATION`
- `demo.github.repo.settings` — non-destructive `CRITICAL` demo routed through the live gateway

The default smoke run exercises only the safe local `PURE` / `READ` / `MUTATION`
paths. The `CRITICAL` demo is opt-in.

## Point the host at the live gateway

```bash
export EFFECT_GATEWAY_URL=http://127.0.0.1:8000
export EFFECT_GATEWAY_TOKEN=replace-me
```

Then opt into the critical demo:

```bash
RUN_CRITICAL_DEMO=1 ./node_modules/.bin/tsx examples/host.ts
```

Without those variables, the host still runs the local smoke path and fails closed
if the critical capability is invoked.

## Smoke

```bash
./node_modules/.bin/tsx examples/host.ts
```
