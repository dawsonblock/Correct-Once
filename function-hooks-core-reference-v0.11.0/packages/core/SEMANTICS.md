# Function Hooks Kernel Semantics — 1.0-rc.1

This document defines the **frozen release-candidate semantic contract** for `@function-hooks/core`. Beginning with the 0.8 release line, the document, conformance case names, and canonical golden trace are bound to a checked-in SHA-256 contract snapshot. Any behavioral change requires a new semantics version rather than silently rewriting `1.0-rc.1`.

## Lifecycle

A runtime transitions `created -> started -> closed`. `start()` is idempotent while started and returns the same frozen engine object. Dispatch before start throws `RuntimeStateError`. Start or dispatch after close throws `RuntimeClosedError`. `close()` is idempotent and aborts in-flight dispatch waits cooperatively; it does not roll back side effects.

## Ordering and wrapping

Hooks are ordered by ascending numeric `order`. Equal orders preserve registration order. Lower numbers therefore wrap higher numbers. A hook may return without calling `next()`, replacing the remainder of the chain.

## Event immutability

Every dispatch input and every value forwarded through `next()` is structured-cloned and deeply frozen before callback execution. The stable event-value domain is primitives, arrays, and plain objects only; exotic mutable containers such as `Map`, `Set`, `Date`, typed arrays, functions, and other non-plain objects are rejected with `UnsupportedEventValueError`. A hook cannot mutate caller-owned event objects through the received reference.

## Matching

Matcher semantics are deterministic structural subset matching. Primitive patterns use `Object.is`. Object patterns require every listed key to match. An array pattern is logical ANY; an empty matcher array never matches. Downstream matchers observe the event forwarded by upstream hooks.

## Continuations

`next()` may be called at most once. A second call fails with `NextMultiplicityError`. The continuation object is immutable. `next.signal` is the derived cooperative cancellation signal. `next.event` is the current event name. `next.origin` is a diagnostic label and is not an authentication identity. `next.is(type, event)` discriminates the active event name; it does not validate arbitrary schemas.

## Recursion

When a hook causes nested dispatch through the engine in its current dispatch frame, that same hook registration is skipped for the nested frame; other matching hooks still participate. The contract does not require a particular context-propagation mechanism.

## Cancellation and deadlines

Caller `AbortSignal` cancellation and optional `timeoutMs` stop awaiting the chain and reject with `DispatchCancelledError` or `DispatchTimeoutError`. `KernelOptions.defaultTimeoutMs` supplies the deadline when a dispatch does not override it. Cancellation is cooperative: JavaScript work already running may continue and external side effects are not undone.

## Errors

Unknown events, lifecycle failures, continuation multiplicity, cancellation/deadline, hook failures, and base implementation failures have distinct semantic error classes. Hook/base errors preserve the original failure as `cause`. Conformance compares semantic error names, not constructor identity across implementations.

## Trace

Trace callbacks are observational only. Records have a monotonically increasing runtime-local `sequence`; wall-clock timestamps are intentionally not part of the stable kernel trace contract. The canonical three-hook phase order is exported from `@function-hooks/core/conformance`.

## Executable conformance

`@function-hooks/core/conformance` exports `runKernelConformance(factory)`, `KERNEL_SEMANTICS_VERSION`, `KERNEL_CONFORMANCE_CASE_NAMES`, and the canonical three-hook trace. The harness builds only the public `EngineBlueprint` shape and does not use the reference runtime's `createBlueprint()` helper. An independent runtime implementing the public `KernelBuilder`/`Runtime` shape can therefore run the same contract without sharing implementation internals.

The frozen `1.0-rc.1` harness contains **21 observable cases** covering ordering, tie stability, short circuiting, caller and forwarded immutability, base immutability, unsupported mutable containers, blueprint snapshotting, rewritten-event matching, matcher array-ANY/empty-never semantics, one-shot continuation, immutable continuation metadata, recursive suppression, concurrent frame isolation, blueprint-only engine exposure, lifecycle, semantic error categories and causes, caller cancellation, explicit deadlines, default deadlines, `next.signal`, close-abort semantics, origin metadata, and the golden trace.

The contract snapshot is stored at `contracts/kernel-semantics-1.0-rc.1.json` in the distribution repository and is checked by `npm run semantics:check`.
