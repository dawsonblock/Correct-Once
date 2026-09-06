// Effect Fabric native durable-effect transition kernel, v0.2.11.
//
// Derived from durable-agent-outbox packages/core/src/reduce.ts (MIT) and maintained as an
// Effect Fabric compatibility kernel. The direct v0.2.11 qualification path imports THIS source,
// never the donor reduce.js implementation. The official donor conformance suite remains the
// behavioral oracle; the release runner also poisons donor reduce() so accidental delegation is
// detected immediately.
//
// SPDX-License-Identifier: MIT
export const EFFECT_FABRIC_NATIVE_KERNEL_VERSION = "0.2.11";
export const EFFECT_FABRIC_NATIVE_REDUCER_METRICS = { calls: 0 };
// The reducer. This is the whole library; everything else is plumbing around it.
//
// `reduce` is PURE and SYNCHRONOUS. It performs no I/O, reads no clock, generates no randomness,
// and never throws. Time and sequence numbers arrive as explicit inputs on the context. The
// consequences are worth the discipline: the decision logic is deterministic, replayable from an
// event log, fuzzable in a tight loop with no scheduler, and testable without a database or a
// network.
//
// It also mirrors the architecture the caller is buying. The imperative shell PROPOSES ("the tool
// said UNKNOWN", "a withdrawal arrived"); the reducer DECIDES what that is allowed to mean. The
// shell can be wrong, late, duplicated or hostile, and the worst it achieves is a rejection with a
// reason attached. `test/contract.test.ts` enforces the boundary by failing if this module tree
// imports anything capable of I/O.
//
// Two rules are load-bearing and neither is negotiable:
//
//   1. NOTHING escapes IN_DOUBT except an authoritative receipt. Not a timeout, not a retry, not
//      an optimistic guess. In two-phase-commit terms, resolving an in-doubt transaction from
//      local state is a "heuristic decision"; here it is available only as an explicit operator
//      override that is audited as exactly that.
//   2. A withdrawal that arrives while the outcome is unknown is RECORDED, NOT APPLIED. Only the
//      receipt can say whether there was anything left to withdraw.
//
// Those two rules are opposite failure modes, and a correct implementation needs both at once.
// Measured on the benchmark this grew out of: five of six frontier-model trials broke rule 1 by
// resolving too eagerly, and the sixth obeyed rule 1 so strictly that it stranded an action in
// IN_DOUBT forever, which fails the liveness obligation instead.

import { idempotencyKeyFingerprint } from "./idempotency.js";
import { isLegalTransition } from "./transitions.js";
import {
  type ActionId,
  type ActionIntent,
  type ActionStatus,
  type AuditCause,
  type AuditEvent,
  type DeliveryId,
  type ExternalAction,
  type IdempotencyKey,
  type LeaseEpoch,
  type Receipt,
  type ReceiptOutcome,
  type RevocationEpoch,
  type TerminalReason,
  type ToolInvocation,
  type WithdrawalKind,
  isTerminal,
  leaseEpoch,
  revision,
} from "./types.js";

// ---------------------------------------------------------------------------------------------
// Commands: everything that can happen to an action.
// ---------------------------------------------------------------------------------------------

export type Command =
  /** A provider delivered a request. Redeliveries of the same intent are no-ops by design. */
  | {
      readonly type: "SUBMIT";
      readonly actionId: ActionId;
      readonly deliveryId: DeliveryId;
      readonly intent: ActionIntent;
      readonly idempotencyKey: IdempotencyKey;
      readonly seq: number;
      /** Highest seq already seen on this subject. A lower seq is born superseded. */
      readonly maxSeqOnSubject: number;
    }
  /** A worker takes (or reclaims) the lease. */
  | { readonly type: "LEASE"; readonly worker: string }
  /** Commit durable intent, then call the tool. The dangerous step. */
  | { readonly type: "BEGIN_ATTEMPT"; readonly epoch: LeaseEpoch; readonly worker: string }
  /** The tool answered, or refused to. */
  | {
      readonly type: "ATTEMPT_RESULT";
      readonly epoch: LeaseEpoch;
      readonly worker: string;
      readonly invocation: ToolInvocation;
    }
  /** An authoritative settlement arrived. The only thing that resolves IN_DOUBT. */
  | { readonly type: "RECEIPT"; readonly receipt: Receipt }
  /** The requester withdrew, or a higher-seq request displaced this one. */
  | {
      readonly type: "WITHDRAW";
      readonly kind: WithdrawalKind;
      readonly epoch: RevocationEpoch;
      readonly bySeq?: number;
      readonly reason?: string;
    }
  /** Bookkeeping complete. Terminal success. */
  | { readonly type: "ACK"; readonly epoch: LeaseEpoch; readonly worker: string }
  /** Process restart: an action left mid-call by a dead worker becomes IN_DOUBT. */
  | { readonly type: "RECOVER" }
  /** Clock advanced: expire leases, escalate actions past the tool's idempotency window. */
  | { readonly type: "TICK" }
  /** Try again after a receipt proved the call did not land. Same idempotency key. */
  | { readonly type: "RETRY" }
  /**
   * A human resolved an in-doubt action out of band (checked the bank statement, called support).
   * Always permitted, always audited as a heuristic decision, always flagged by the legality
   * checker. Present because real operations need it, explicit because it is not free.
   */
  | {
      readonly type: "OPERATOR_RESOLVE";
      readonly assume: ReceiptOutcome;
      readonly reason: string;
      readonly operator: string;
    };

// ---------------------------------------------------------------------------------------------
// Context, effects, results.
// ---------------------------------------------------------------------------------------------

export interface OutboxPolicy {
  /** Lease duration in ms. Must comfortably exceed the time one attempt can take. */
  readonly leaseMs: number;
  /**
   * How long the external tool remembers an idempotency key, or `null` if forever.
   *
   * This is not a detail. Stripe expires keys at 24h; SQS deduplication is a 5 minute window. An
   * action that sits IN_DOUBT past the window can never be safely retried, because the tool has
   * forgotten the key and a retry would cross a second time. The reducer escalates rather than
   * gamble. See docs/WHY_THIS_EXISTS.md.
   */
  readonly idempotencyWindowMs: number | null;
  /** Attempts before giving up. Counts invocations, never influences the idempotency key. */
  readonly maxAttempts: number;
}

export const DEFAULT_POLICY: OutboxPolicy = {
  leaseMs: 30_000,
  idempotencyWindowMs: 24 * 60 * 60 * 1000,
  maxAttempts: 8,
};

export interface ReduceContext {
  /** Injected clock. The reducer never reads time itself. */
  readonly now: number;
  /** First audit sequence number this call may use. Must be globally monotonic. */
  readonly nextAuditSeq: number;
  readonly policy: OutboxPolicy;
}

/** Work the shell must perform. Descriptions only; the reducer performs nothing. */
export type Effect =
  | {
      readonly type: "CALL_TOOL";
      readonly actionId: ActionId;
      readonly idempotencyKey: IdempotencyKey;
      readonly intent: ActionIntent;
    }
  | { readonly type: "POLL_RECEIPTS"; readonly actionId: ActionId; readonly key: IdempotencyKey }
  | { readonly type: "SCHEDULE_RETRY"; readonly actionId: ActionId }
  | {
      readonly type: "ESCALATE";
      readonly actionId: ActionId;
      readonly reason: TerminalReason;
      readonly detail: string;
    };

export type RejectionCode =
  /** Acting under a lease the action no longer recognises. Must have no effect at all. */
  | "STALE_EPOCH"
  /** The same intent was delivered again. Not an error; the point of an idempotency key. */
  | "DUPLICATE_DELIVERY"
  /** The action has finished. Nothing further is legal, including withdrawal. */
  | "ALREADY_TERMINAL"
  /** The command does not apply in this status. */
  | "NOT_APPLICABLE"
  /** The command would have produced a transition the state machine does not contain. */
  | "ILLEGAL_TRANSITION"
  /** A receipt for a different idempotency key. */
  | "RECEIPT_MISMATCH"
  /** No such action. */
  | "UNKNOWN_ACTION"
  /** Structurally malformed command. */
  | "INVALID_COMMAND";

export interface Rejection {
  readonly code: RejectionCode;
  readonly message: string;
}

export interface ReduceResult {
  /** The next action state, or the unchanged input when nothing happened. */
  readonly action: ExternalAction | undefined;
  readonly events: readonly AuditEvent[];
  readonly effects: readonly Effect[];
  readonly rejection?: Rejection;
  /** False means the shell must not write anything. A no-op is genuinely a no-op. */
  readonly changed: boolean;
}

// ---------------------------------------------------------------------------------------------
// Internals.
// ---------------------------------------------------------------------------------------------

/**
 * Accumulates transitions for one reduce call, enforcing the legality table on every hop.
 *
 * Routing every status change through here is why an illegal transition cannot be produced by
 * accident: there is no other way to write `status`.
 */
class Trace {
  private seq: number;
  readonly events: AuditEvent[] = [];
  readonly effects: Effect[] = [];
  illegal: { from: ActionStatus | null; to: ActionStatus } | undefined;

  constructor(
    private readonly at: number,
    startSeq: number,
  ) {
    this.seq = startSeq;
  }

  /** Record a transition. Returns the new status, or the old one if the hop was illegal. */
  move(
    action: ExternalAction | undefined,
    from: ActionStatus | null,
    to: ActionStatus,
    cause: AuditCause,
    opts: { epoch?: LeaseEpoch; worker?: string; detail?: string; actionId?: ActionId } = {},
  ): ActionStatus {
    if (!isLegalTransition(from, to)) {
      this.illegal = { from, to };
      return from ?? to;
    }
    const id = opts.actionId ?? action?.id;
    if (id === undefined) return to;
    this.events.push({
      seq: this.seq++,
      actionId: id,
      from,
      to,
      epoch: opts.epoch ?? action?.epoch ?? leaseEpoch(0),
      at: this.at,
      ...(opts.worker !== undefined ? { worker: opts.worker } : {}),
      cause,
      ...(opts.detail !== undefined ? { detail: opts.detail } : {}),
    });
    return to;
  }

  effect(e: Effect): void {
    this.effects.push(e);
  }
}

const reject = (
  action: ExternalAction | undefined,
  code: RejectionCode,
  message: string,
): ReduceResult => ({
  action,
  events: [],
  effects: [],
  rejection: { code, message },
  changed: false,
});

const bump = (a: ExternalAction, patch: Partial<ExternalAction>): ExternalAction => ({
  ...a,
  ...patch,
  revision: revision(a.revision + 1),
});

/** True when the tool can no longer be trusted to deduplicate this action's key. */
function windowElapsed(a: ExternalAction, ctx: ReduceContext): boolean {
  const w = ctx.policy.idempotencyWindowMs;
  if (w === null || a.firstAttemptAt === undefined) return false;
  return ctx.now - a.firstAttemptAt > w;
}

/**
 * Apply a withdrawal that has been proven safe to apply, given what we now know about whether the
 * side effect crossed. Called only from points where the answer is known.
 */
function applyWithdrawal(
  t: Trace,
  a: ExternalAction,
  from: ActionStatus,
  kind: WithdrawalKind,
  crossed: boolean,
  detail: string | undefined,
): ActionStatus {
  if (crossed) {
    return kind === "REVOKED"
      ? t.move(a, from, "EXECUTED_THEN_WITHDRAWN", "withdrawn_after_execution", { detail })
      : t.move(a, from, "EXECUTED_THEN_SUPERSEDED", "superseded_after_execution", { detail });
  }
  return kind === "REVOKED"
    ? t.move(a, from, "REVOKED_BEFORE_EXECUTION", "withdrawn_before_execution", { detail })
    : t.move(a, from, "SUPERSEDED_BEFORE_EXECUTION", "superseded_before_execution", { detail });
}

// ---------------------------------------------------------------------------------------------
// reduce
// ---------------------------------------------------------------------------------------------

/**
 * Decide what one command means for one action.
 *
 * Actions are independent by construction, so this only ever sees a single action. Cross-action
 * concerns (finding the siblings a supersession displaces, choosing which action to lease next)
 * belong to the shell, which turns them into per-action commands. That split is what keeps this
 * function pure and what makes the progress guarantee possible: one action stuck in IN_DOUBT
 * cannot block another, because nothing here can even refer to another action.
 */
export function reduce(
  state: ExternalAction | undefined,
  command: Command,
  ctx: ReduceContext,
): ReduceResult {
  EFFECT_FABRIC_NATIVE_REDUCER_METRICS.calls += 1;
  const t = new Trace(ctx.now, ctx.nextAuditSeq);
  const result = apply(state, command, ctx, t);

  // Defence in depth, and it has already earned its place.
  //
  // `Trace.move` refuses an illegal hop by returning the OLD status without writing an audit row.
  // On its own that is not enough: a case arm that ignores the returned status and commits its own
  // patch anyway produces an action that changed with no trail explaining it. That is the precise
  // shape of lie this library exists to prevent, so a refused hop must abort the whole command
  // rather than be silently absorbed. A real defect reached the test suite this way.
  if (t.illegal !== undefined) {
    const { from, to } = t.illegal;
    return reject(
      state,
      "ILLEGAL_TRANSITION",
      `${String(from)} -> ${to} is not in the state machine; command ${command.type} refused`,
    );
  }

  // Totality. The switch below is exhaustive over `Command`, which TypeScript checks, but a
  // malformed command from an untyped boundary (JSON off a queue, a JS caller) would otherwise
  // fall off the end and return undefined. `reduce` never throws and never returns undefined.
  if (result === undefined) {
    return reject(
      state,
      "INVALID_COMMAND",
      `unrecognised command type ${String((command as { type?: unknown }).type)}`,
    );
  }

  return result;
}

function apply(
  state: ExternalAction | undefined,
  command: Command,
  ctx: ReduceContext,
  t: Trace,
): ReduceResult | undefined {
  // ---- SUBMIT is the only command that may create ----------------------------------------------
  if (command.type === "SUBMIT") {
    if (state !== undefined) {
      if (state.deliveries.includes(command.deliveryId)) {
        return reject(state, "DUPLICATE_DELIVERY", `delivery ${command.deliveryId} already seen`);
      }
      // A new delivery of an intent we already hold. Record it for forensics; change nothing else.
      // This is the redelivery no-op that makes at-least-once transports safe.
      return {
        action: bump(state, { deliveries: [...state.deliveries, command.deliveryId] }),
        events: [],
        effects: [],
        rejection: { code: "DUPLICATE_DELIVERY", message: "intent already in the outbox" },
        changed: true,
      };
    }

    const born: ExternalAction = {
      id: command.actionId,
      intent: command.intent,
      idempotencyKey: command.idempotencyKey,
      seq: command.seq,
      status: "READY",
      epoch: leaseEpoch(0),
      revision: revision(1),
      attempted: false,
      attempts: 0,
      deliveries: [command.deliveryId],
    };
    t.move(born, null, "READY", "approved", { detail: `seq=${command.seq}` });

    // Born already displaced. The creation row still has to exist: an action that was never
    // recorded as READY cannot have an honest trail explaining why it never ran.
    if (command.seq < command.maxSeqOnSubject) {
      const status = t.move(
        born,
        "READY",
        "SUPERSEDED_BEFORE_EXECUTION",
        "superseded_before_execution",
        {
          detail: `outranked by seq=${command.maxSeqOnSubject}`,
        },
      );
      return {
        action: { ...born, status, revision: revision(2) },
        events: t.events,
        effects: t.effects,
        changed: true,
      };
    }

    return { action: born, events: t.events, effects: t.effects, changed: true };
  }

  if (state === undefined) {
    return reject(undefined, "UNKNOWN_ACTION", `no action for command ${command.type}`);
  }

  const a = state;

  // ---- Terminal actions accept nothing, including withdrawal -----------------------------------
  // A withdrawal arriving after the action finished is not an error and not a transition. It is
  // simply too late. Recording it as a state change would put a false statement on the trail.
  if (isTerminal(a.status)) {
    return reject(
      a,
      "ALREADY_TERMINAL",
      `action ${a.id} is ${a.status}; ${command.type} has no effect`,
    );
  }

  switch (command.type) {
    // -------------------------------------------------------------------------------------------
    case "LEASE": {
      const expired =
        a.status === "LEASED" && a.leaseExpiresAt !== undefined && ctx.now >= a.leaseExpiresAt;
      if (a.status !== "READY" && !expired) {
        return reject(a, "NOT_APPLICABLE", `cannot lease an action in ${a.status}`);
      }
      const epoch = leaseEpoch(a.epoch + 1);
      const status = t.move(a, a.status, "LEASED", expired ? "lease_reclaimed" : "leased", {
        epoch,
        worker: command.worker,
      });
      return {
        action: bump(a, {
          status,
          epoch,
          owner: command.worker,
          leaseExpiresAt: ctx.now + ctx.policy.leaseMs,
        }),
        events: t.events,
        effects: t.effects,
        changed: true,
      };
    }

    // -------------------------------------------------------------------------------------------
    case "BEGIN_ATTEMPT": {
      if (a.status !== "LEASED") {
        return reject(a, "NOT_APPLICABLE", `cannot begin an attempt from ${a.status}`);
      }
      if (a.epoch !== command.epoch || a.owner !== command.worker) {
        return reject(
          a,
          "STALE_EPOCH",
          `worker ${command.worker}@${command.epoch} no longer holds ${a.id}@${a.epoch}`,
        );
      }
      if (a.leaseExpiresAt !== undefined && ctx.now >= a.leaseExpiresAt) {
        return reject(a, "STALE_EPOCH", `lease on ${a.id} expired before the attempt began`);
      }
      if (a.attempts >= ctx.policy.maxAttempts) {
        const status = t.move(a, a.status, "FAILED_TERMINAL", "reconciliation_required", {
          detail: `attempts=${a.attempts}`,
        });
        t.effect({
          type: "ESCALATE",
          actionId: a.id,
          reason: "RETRY_BUDGET_EXHAUSTED",
          detail: `${a.attempts} attempts`,
        });
        return {
          action: bump(a, { status, terminalReason: "RETRY_BUDGET_EXHAUSTED", owner: undefined }),
          events: t.events,
          effects: t.effects,
          changed: true,
        };
      }
      // Retrying after the tool has forgotten the key would produce a SECOND side effect. Neither
      // retrying nor presuming is acceptable, so hand it to a human.
      if (windowElapsed(a, ctx)) {
        const status = t.move(a, a.status, "FAILED_TERMINAL", "reconciliation_required", {
          detail: "idempotency window elapsed",
        });
        t.effect({
          type: "ESCALATE",
          actionId: a.id,
          reason: "RECONCILIATION_REQUIRED",
          detail: "the tool no longer remembers this idempotency key; a retry could double-execute",
        });
        return {
          action: bump(a, { status, terminalReason: "RECONCILIATION_REQUIRED", owner: undefined }),
          events: t.events,
          effects: t.effects,
          changed: true,
        };
      }

      // Durable intent is committed BEFORE the call. After a crash this flag is the only evidence
      // that a call carrying this key may be in flight.
      //
      // The row carries a FINGERPRINT of the idempotency key, never the key itself. The key is a
      // credential at several providers, and a trail is the one artifact here built to be exported,
      // so putting the key on it sends the credential everywhere the trail goes. The full key stays
      // on the action row where reconciliation can reach it; `idempotencyKeyFingerprint` is the join
      // between the two.
      const status = t.move(a, a.status, "ATTEMPTING", "intent_committed", {
        epoch: command.epoch,
        worker: command.worker,
        detail: `keyfp=${idempotencyKeyFingerprint(a.idempotencyKey)}`,
      });
      t.effect({
        type: "CALL_TOOL",
        actionId: a.id,
        idempotencyKey: a.idempotencyKey,
        intent: a.intent,
      });
      return {
        action: bump(a, {
          status,
          attempted: true,
          attempts: a.attempts + 1,
          firstAttemptAt: a.firstAttemptAt ?? ctx.now,
        }),
        events: t.events,
        effects: t.effects,
        changed: true,
      };
    }

    // -------------------------------------------------------------------------------------------
    case "ATTEMPT_RESULT": {
      if (a.status !== "ATTEMPTING") {
        return reject(a, "NOT_APPLICABLE", `no attempt in flight; action is ${a.status}`);
      }
      if (a.epoch !== command.epoch || a.owner !== command.worker) {
        return reject(
          a,
          "STALE_EPOCH",
          `result from ${command.worker}@${command.epoch}; active owner is ${String(a.owner)}@${a.epoch}`,
        );
      }
      const inv = command.invocation;
      const pending = a.pendingWithdrawal;

      if (inv.outcome === "OK") {
        let status = t.move(a, "ATTEMPTING", "EXECUTED", "tool_ok", { worker: command.worker });
        if (pending) {
          // It crossed, and someone had already asked us to stop. Both facts are true, and the
          // trail carries both: EXECUTED first, then the withdrawal that arrived too late.
          status = applyWithdrawal(t, a, status, pending.kind, true, pending.reason);
        }
        return {
          action: bump(a, {
            status,
            owner: undefined,
            leaseExpiresAt: undefined,
            ...(inv.receiptId !== undefined ? { settledBy: inv.receiptId } : {}),
          }),
          events: t.events,
          effects: t.effects,
          changed: true,
        };
      }

      if (inv.outcome === "UNKNOWN") {
        // The call did not come back with an answer. It is not a success and it is not a failure,
        // and guessing either way is wrong on some run. Park it durably and wait to be told.
        const status = t.move(a, "ATTEMPTING", "IN_DOUBT", "tool_unknown", {
          worker: command.worker,
        });
        t.effect({ type: "POLL_RECEIPTS", actionId: a.id, key: a.idempotencyKey });
        return {
          action: bump(a, { status, owner: undefined, leaseExpiresAt: undefined }),
          events: t.events,
          effects: t.effects,
          changed: true,
        };
      }

      // FAILED. The tool is asserting the call did not take effect.
      if (inv.terminal) {
        const status = t.move(a, "ATTEMPTING", "FAILED_TERMINAL", "tool_failed", {
          worker: command.worker,
          detail: inv.error,
        });
        t.effect({
          type: "ESCALATE",
          actionId: a.id,
          reason: "TOOL_PERMANENT_ERROR",
          detail: inv.error,
        });
        return {
          action: bump(a, {
            status,
            terminalReason: "TOOL_PERMANENT_ERROR",
            owner: undefined,
            leaseExpiresAt: undefined,
          }),
          events: t.events,
          effects: t.effects,
          changed: true,
        };
      }

      let status = t.move(a, "ATTEMPTING", "READY", "tool_failed", {
        worker: command.worker,
        detail: inv.error,
      });
      if (pending) {
        // Nothing crossed and a withdrawal is waiting. Now it is safe to honour it.
        status = applyWithdrawal(t, a, status, pending.kind, false, pending.reason);
      }
      return {
        action: bump(a, {
          status,
          attempted: false,
          owner: undefined,
          leaseExpiresAt: undefined,
          ...(pending ? { pendingWithdrawal: undefined } : {}),
        }),
        events: t.events,
        effects: t.effects,
        changed: true,
      };
    }

    // -------------------------------------------------------------------------------------------
    case "RECEIPT": {
      if (command.receipt.idempotencyKey !== a.idempotencyKey) {
        return reject(a, "RECEIPT_MISMATCH", "receipt is for a different idempotency key");
      }
      if (a.status !== "IN_DOUBT") {
        // Receipts are re-readable and may be replayed forever. Outside IN_DOUBT they teach us
        // nothing we do not already know, so seeing one again must change nothing.
        return reject(a, "NOT_APPLICABLE", `receipt ignored; action is ${a.status}`);
      }

      const pending = a.pendingWithdrawal;

      if (command.receipt.outcome === "LANDED") {
        let status = t.move(a, "IN_DOUBT", "EXECUTED", "receipt_landed", {
          detail: command.receipt.id,
        });
        if (pending) {
          status = applyWithdrawal(t, a, status, pending.kind, true, pending.reason);
        }
        return {
          action: bump(a, { status, settledBy: command.receipt.id }),
          events: t.events,
          effects: t.effects,
          changed: true,
        };
      }

      // NOT_LANDED. Authoritative: nothing crossed. A retry is now safe under the same key, and
      // is safe even if the tool has since forgotten the key, because there is nothing to
      // deduplicate against.
      let status = t.move(a, "IN_DOUBT", "NOT_LANDED", "receipt_not_landed", {
        detail: command.receipt.id,
      });
      if (pending) {
        status = applyWithdrawal(t, a, status, pending.kind, false, pending.reason);
      } else {
        t.effect({ type: "SCHEDULE_RETRY", actionId: a.id });
      }
      return {
        action: bump(a, {
          status,
          settledBy: command.receipt.id,
          attempted: false,
          ...(pending ? { pendingWithdrawal: undefined } : {}),
        }),
        events: t.events,
        effects: t.effects,
        changed: true,
      };
    }

    // -------------------------------------------------------------------------------------------
    case "WITHDRAW": {
      const { kind, epoch, bySeq, reason } = command;
      const detail = reason ?? (bySeq !== undefined ? `bySeq=${bySeq}` : undefined);

      // THE CRUX. While the outcome is unknown we cannot know whether there is anything left to
      // withdraw. Record the request and let the receipt decide what it meant. Applying it here
      // is the single mistake that failed five of six frontier-model trials.
      if (a.status === "IN_DOUBT" || a.status === "ATTEMPTING") {
        if (a.pendingWithdrawal !== undefined) {
          if (epoch <= a.pendingWithdrawal.epoch) {
            return reject(
              a,
              "STALE_EPOCH",
              `withdrawal epoch ${epoch} is not newer than ${a.pendingWithdrawal.epoch}`,
            );
          }
          return reject(a, "NOT_APPLICABLE", `a withdrawal is already recorded on ${a.id}`);
        }
        const status = t.move(a, a.status, a.status, "withdrawal_recorded", {
          detail: `${kind}${detail ? `:${detail}` : ""}`,
        });
        return {
          action: bump(a, {
            status,
            pendingWithdrawal: {
              kind,
              epoch,
              ...(bySeq !== undefined ? { bySeq } : {}),
              ...(reason !== undefined ? { reason } : {}),
            },
          }),
          events: t.events,
          effects: t.effects,
          changed: true,
        };
      }

      // Provably still on this side of the boundary.
      if (a.status === "READY" || a.status === "LEASED" || a.status === "NOT_LANDED") {
        const status = applyWithdrawal(t, a, a.status, kind, false, detail);
        return {
          action: bump(a, { status, owner: undefined, leaseExpiresAt: undefined }),
          events: t.events,
          effects: t.effects,
          changed: true,
        };
      }

      // Provably across it. The side effect stands; the trail records that it was withdrawn after.
      if (a.status === "EXECUTED") {
        const status = applyWithdrawal(t, a, a.status, kind, true, detail);
        return {
          action: bump(a, { status }),
          events: t.events,
          effects: t.effects,
          changed: true,
        };
      }

      return reject(a, "NOT_APPLICABLE", `cannot withdraw from ${a.status}`);
    }

    // -------------------------------------------------------------------------------------------
    case "ACK": {
      if (a.status !== "EXECUTED") {
        return reject(a, "NOT_APPLICABLE", `cannot acknowledge from ${a.status}`);
      }
      if (a.epoch !== command.epoch) {
        return reject(
          a,
          "STALE_EPOCH",
          `ack from ${command.worker}@${command.epoch}; action is at epoch ${a.epoch}`,
        );
      }
      if (command.worker.length === 0) {
        return reject(a, "INVALID_COMMAND", "ack worker must be non-empty");
      }
      const status = t.move(a, "EXECUTED", "ACKED", "acked", { worker: command.worker });
      return {
        action: bump(a, { status, owner: undefined, leaseExpiresAt: undefined }),
        events: t.events,
        effects: t.effects,
        changed: true,
      };
    }

    // -------------------------------------------------------------------------------------------
    case "RECOVER": {
      // The crash-after-tool case, and the reason `attempted` is committed before the call. The
      // side effect may have happened and nothing local recorded it. That is exactly IN_DOUBT.
      if (a.status !== "ATTEMPTING") {
        return reject(a, "NOT_APPLICABLE", `nothing to recover; action is ${a.status}`);
      }
      const status = t.move(a, "ATTEMPTING", "IN_DOUBT", "crash_recovered", {
        detail: "worker died between the call and its own bookkeeping",
      });
      t.effect({ type: "POLL_RECEIPTS", actionId: a.id, key: a.idempotencyKey });
      return {
        action: bump(a, { status, owner: undefined, leaseExpiresAt: undefined }),
        events: t.events,
        effects: t.effects,
        changed: true,
      };
    }

    // -------------------------------------------------------------------------------------------
    case "TICK": {
      if (a.status === "LEASED" && a.leaseExpiresAt !== undefined && ctx.now >= a.leaseExpiresAt) {
        const status = t.move(a, "LEASED", "READY", "lease_expired", {
          detail: `expired at ${a.leaseExpiresAt}`,
        });
        return {
          action: bump(a, { status, owner: undefined, leaseExpiresAt: undefined }),
          events: t.events,
          effects: t.effects,
          changed: true,
        };
      }

      // Unresolved past the point where the tool still remembers the key. Retrying could double
      // execute and presuming is forbidden, so this needs a human with access to the tool's own
      // records. Escalating is the honest move; both alternatives are guesses.
      if (a.status === "IN_DOUBT" && windowElapsed(a, ctx)) {
        const status = t.move(a, "IN_DOUBT", "FAILED_TERMINAL", "reconciliation_required", {
          detail: "no receipt arrived before the idempotency window elapsed",
        });
        t.effect({
          type: "ESCALATE",
          actionId: a.id,
          reason: "RECONCILIATION_REQUIRED",
          detail: "in doubt past the tool's idempotency window; resolve against the tool's records",
        });
        return {
          action: bump(a, { status, terminalReason: "RECONCILIATION_REQUIRED" }),
          events: t.events,
          effects: t.effects,
          changed: true,
        };
      }

      return reject(a, "NOT_APPLICABLE", "nothing due");
    }

    // -------------------------------------------------------------------------------------------
    case "RETRY": {
      if (a.status !== "NOT_LANDED") {
        return reject(a, "NOT_APPLICABLE", `cannot retry from ${a.status}`);
      }
      const status = t.move(a, "NOT_LANDED", "READY", "retry_scheduled", {
        detail: `attempt ${a.attempts + 1} under the same key`,
      });
      return {
        action: bump(a, { status, attempted: false }),
        events: t.events,
        effects: t.effects,
        changed: true,
      };
    }

    // -------------------------------------------------------------------------------------------
    case "OPERATOR_RESOLVE": {
      if (a.status !== "IN_DOUBT") {
        return reject(a, "NOT_APPLICABLE", "only an in-doubt action can be resolved by hand");
      }
      const detail = `operator=${command.operator} assume=${command.assume} reason=${command.reason}`;
      const pending = a.pendingWithdrawal;
      let status =
        command.assume === "LANDED"
          ? t.move(a, "IN_DOUBT", "EXECUTED", "operator_override", { detail })
          : t.move(a, "IN_DOUBT", "NOT_LANDED", "operator_override", { detail });
      if (pending) {
        status = applyWithdrawal(
          t,
          a,
          status,
          pending.kind,
          command.assume === "LANDED",
          pending.reason,
        );
      }
      return {
        action: bump(a, {
          status,
          attempted: command.assume === "LANDED",
          ...(pending ? { pendingWithdrawal: undefined } : {}),
        }),
        events: t.events,
        effects: t.effects,
        changed: true,
      };
    }
  }
}
