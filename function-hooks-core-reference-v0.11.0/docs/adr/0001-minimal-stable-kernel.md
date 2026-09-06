# ADR-0001: Minimal stable kernel boundary

Status: Accepted for v0.4.0 migration candidate.

## Decision

`@function-hooks/core` owns only typed event maps, immutable dispatch, deterministic matcher semantics, ordered hooks, one-shot continuations, runtime lifecycle, cooperative cancellation/deadlines, trace observation, engine blueprints, and semantic errors.

`@function-hooks/events` owns the optional standard event catalog and host-adapter bindings.

The v0.3 assurance-heavy `FunctionHooksRuntime` remains in the compatibility umbrella for the 0.4 line. It is deprecated, not silently redefined. Assurance, audit, replay, isolation, plugin admission/management, and enterprise policy remain on that compatibility path until the 0.5 internal-consumer migration.

## Why

The previous runtime imported budget policy, canonical serialization, and schema validation directly. That made assurance policy part of the dispatch substrate and prevented the kernel from evolving or being reimplemented independently.

## Rejected approach

We explicitly rejected creating eight nominal packages that simply re-exported the old cyclic source tree. That would produce package names without a real dependency boundary and would make the release look more complete than it is.
