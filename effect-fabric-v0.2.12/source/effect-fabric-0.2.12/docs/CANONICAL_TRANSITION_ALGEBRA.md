# Canonical Transition Algebra — v0.2.8

Effect Fabric v0.2.8 introduces a versioned structural execution-state specification at `spec/effect-transition-v1.json`. The JSON document is the source for generated Python and TypeScript tables. Runtime transition decisions are made by `src/effect_fabric/transition_kernel.py`.

## Scope

The canonical algebra defines legal execution-state edges and command-to-edge relationships. It deliberately does not encode clocks, provider calls, SQL, credentials, policy decisions, fencing arithmetic, or external receipt authentication. Those facts remain explicit inputs and guards in the outer runtime.

## Runtime rule

All production `execution_state` mutation under `src/effect_fabric` is centralized in `transition_kernel.py`. Stores independently validate old→new state edges before persistence, providing a second boundary against illegal jumps.

## Compatibility rule

The DAO compatibility reducer has a richer lifecycle than the production Effect Fabric execution enum. `dao_crosswalk.py` therefore maps donor states to semantic classes instead of claiming one-to-one identity. Unknown donor statuses fail closed.

## Generation

Regenerate tables with:

```bash
python scripts/generate_transition_tables.py
```

Verify generated files are current with:

```bash
python scripts/generate_transition_tables.py --check
```

Release qualification fails if generated tables drift from the canonical spec or if runtime execution-state assignments reappear outside the kernel.
