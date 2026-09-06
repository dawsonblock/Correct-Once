# Runtime support matrix — v0.11.0

| Target | Reference `@function-hooks/core` | `@function-hooks/portable` | `@function-hooks/gateway` | `@function-hooks/router` | Evidence |
|---|---:|---:|---:|---:|---|
| Node 22 | Qualified | Qualified | Qualified | Qualified with gateway | Full tests, dual conformance, differential campaign, gateway concurrency/security suite, router integration suite |
| DOM/Web TypeScript environment | No | Compile-qualified | No | Not claimed | Portable `types: []` ES2022+DOM compile and source gate |
| Browser main thread | Not claimed | Not executed | Not claimed | Not claimed | No live browser runner in this environment |
| Web Worker | Not claimed | Not executed | Not claimed | Not claimed | No live worker runner in this environment |
| Deno | Not claimed | Not executed | Not claimed | Not claimed | Deno not installed in qualification environment |
| Bun | Not claimed | Not executed | Not claimed | Not claimed | Bun not installed in qualification environment |

`@function-hooks/gateway` is currently a Node-targeted host gateway because its packaged Node adapters use filesystem, process, and network host facilities. Browser/MCP/desktop action implementations are explicit callbacks rather than bundled ambient authority. `@function-hooks/router` is routing configuration above that gateway and does not add authority of its own.
