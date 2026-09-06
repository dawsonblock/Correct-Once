# Third-party notices

Effect Fabric is primarily licensed under Apache-2.0. The following checked-in compatibility
artifact contains MIT-derived material and retains the donor license terms:

- `bridges/durable-agent-outbox/effect_fabric_native_reduce.ts` — derived from
  `durable-agent-outbox/packages/core/src/reduce.ts`.
- Qualification may also derive a temporary scheduler from the locked donor
  `packages/core/src/worker.ts`; that generated scheduler is used only inside the qualification
  workspace and is not shipped as donor source.

Upstream project: `durable-agent-outbox`.
Copyright: Copyright (c) 2026 Mathew Stevens.
License: MIT. The complete license text is bundled at
`LICENSES/durable-agent-outbox-MIT.txt` and in the installed wheel under
`share/effect-fabric/licenses/`.

Other donor repositories described in `DONOR_LOCK.json` are used as design, protocol, or
qualification references. Their source trees are not bundled into this distribution unless a
specific checked-in derived artifact is identified above.
