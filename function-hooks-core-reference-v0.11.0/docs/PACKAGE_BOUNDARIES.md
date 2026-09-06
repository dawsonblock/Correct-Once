# Package boundary status — 0.11.0

| Package | Status | Allowed Function Hooks dependencies |
|---|---|---|
| `@function-hooks/core` | frozen `1.0-rc.1` candidate reference kernel | none |
| `@function-hooks/portable` | independent candidate runtime | core **types/contracts only by source policy** |
| `@function-hooks/events` | stable-candidate catalog | core |
| `@function-hooks/assurance` | experimental | core |
| `@function-hooks/audit` | experimental | core, assurance |
| `@function-hooks/replay` | experimental | core, assurance |
| `@function-hooks/plugins` | experimental | core, assurance |
| `@function-hooks/isolation` | experimental | core, plugins |
| `@function-hooks/enterprise` | experimental | core, assurance, audit |
| `@function-hooks/compat` | deprecated migration-only | assurance |
| `@function-hooks/gateway` | fail-closed action authority/execution boundary | core, assurance, audit |
| `@function-hooks/capabilities` | candidate/admission/registry/catalog model | none |
| `@function-hooks/router` | manual + admitted capability route compilation | gateway, capabilities |

The router may depend downward on the gateway and capability model; neither gateway nor capabilities may depend upward on router/application configuration. This keeps app-specific route catalogs out of the execution authority layer.

The root `function-hooks-core-reference` package is a distribution facade. Its root declaration contains no compatibility-runtime exports. Legacy wildcard/schema/`engine.create` behavior is reachable only through the explicit `./compat` subpath or direct `@function-hooks/compat` package.

`tools/check-package-boundaries.mjs` rejects undeclared Function Hooks dependencies, reverse/cross-layer imports, and source reach-through. No stable or experimental package may depend on `@function-hooks/compat`.
