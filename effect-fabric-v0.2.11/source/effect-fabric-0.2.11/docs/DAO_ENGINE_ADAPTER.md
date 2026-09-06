# DAO Engine Compatibility Paths

Effect Fabric retains several progressively stronger durable-agent-outbox compatibility gates for
regression and provenance purposes:

1. **Store adapter:** donor worker/reducer against Effect Fabric SQLite `OutboxStore` behavior.
2. **Structural engine adapter:** donor worker behind an Effect Fabric `OutboxEngine` surface with an
   independent execution-state shadow.
3. **Active scheduler/pre-commit path:** `EffectFabricActiveScheduler` replaces the donor worker class
   but historically retains the donor pure reducer.
4. **Native transition-kernel path (v0.2.6+):** the active scheduler imports
   `effect_fabric_native_reduce.ts`; donor `reduce()` is poisoned and must not be invoked.

The fourth path is the strongest DAO compatibility boundary. The older paths remain useful as
regression controls and should not be mistaken for the current promotion frontier.

None of these paths means the production `EffectEngine` transaction/capability/evidence lifecycle has
been replaced by the DAO state machine. That is a separate architectural promotion.
