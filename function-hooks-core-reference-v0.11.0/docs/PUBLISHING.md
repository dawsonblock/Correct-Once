# Publishing order for v0.11.0

1. `@function-hooks/core@0.11.0`
2. `@function-hooks/portable@0.11.0`, `@function-hooks/events@0.11.0`, `@function-hooks/assurance@0.11.0`, `@function-hooks/capabilities@0.11.0`
3. `@function-hooks/audit@0.11.0`, `@function-hooks/replay@0.11.0`, `@function-hooks/plugins@0.11.0`
4. `@function-hooks/isolation@0.11.0`, `@function-hooks/enterprise@0.11.0`
5. `@function-hooks/gateway@0.11.0`
6. `@function-hooks/router@0.11.0`
7. `@function-hooks/compat@0.11.0`
8. `function-hooks-core-reference@0.11.0`

All internal Function Hooks dependencies are exact-pinned to `0.11.0`. Run `npm run qualify`, all `npm pack --dry-run` checks, offline tarball consumer smoke tests, and exact-ZIP extraction qualification before publication.
