import type { HashChainAuditLedger } from "@function-hooks/audit";
import type { RuntimeTraceRecord, EventMap, EventName, EngineBlueprint, KernelBuilder } from "@function-hooks/core";
export interface EnterpriseNext { (event: unknown): Promise<unknown>; readonly event: string; readonly origin: string; readonly signal: AbortSignal; }
export interface EnterpriseRegistrar { (event: string, callback: (engine: unknown, event: unknown, next: EnterpriseNext) => unknown | Promise<unknown>): void; (event: string, matcher: unknown, callback: (engine: unknown, event: unknown, next: EnterpriseNext) => unknown | Promise<unknown>): void; }
export interface EnterpriseRuntimePort { registrar(plugin: string, order: number): EnterpriseRegistrar; }
interface LegacyEventDefinition { readonly name: string; }
interface LegacyBlueprint { readonly events: ReadonlyMap<string, LegacyEventDefinition>; }
function filterLegacyEvents(below: LegacyBlueprint, predicate: (definition: LegacyEventDefinition) => boolean): LegacyBlueprint { return Object.freeze({ events: new Map([...below.events].filter(([, definition]) => predicate(definition))) }); }

export function registerAuditPlugin(
  runtime: EnterpriseRuntimePort,
  pluginOrder: number,
  sink: (record: { origin: string; event: string; at: number; input: unknown; result?: unknown; error?: string }) => void | Promise<void>,
): void {
  const on = runtime.registrar("enterprise-audit", pluginOrder);
  on("*", async (_$, event, next) => {
    const at = Date.now();
    try {
      const result = await next(event);
      await sink({ origin: next.origin, event: next.event, at, input: event, ...(result === undefined ? {} : { result }) });
      return result;
    } catch (error) {
      await sink({ origin: next.origin, event: next.event, at, input: event, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  });
}

export function registerHashChainAuditPlugin(runtime: EnterpriseRuntimePort, pluginOrder: number, ledger: HashChainAuditLedger): void {
  registerAuditPlugin(runtime, pluginOrder, async (record) => { ledger.append(record); });
}

export function registerBlastDoorPlugin(
  runtime: EnterpriseRuntimePort,
  pluginOrder: number,
  allowedEvents: ReadonlySet<string>,
): void {
  const on = runtime.registrar("enterprise-blast-door", pluginOrder);
  on("engine.create", async (_$, event, next) => {
    const below = await next(event) as LegacyBlueprint;
    return filterLegacyEvents(below, (definition) => allowedEvents.has(definition.name));
  });
}

export function registerOriginAllowlistPlugin(
  runtime: EnterpriseRuntimePort,
  pluginOrder: number,
  rules: Readonly<Record<string, readonly string[]>>,
): void {
  const on = runtime.registrar("enterprise-origin-allowlist", pluginOrder);
  on("*", async (_$, event, next) => {
    const allowed = rules[next.event];
    if (allowed && !allowed.includes(next.origin)) throw new Error(`Origin ${next.origin} is not permitted to call ${next.event}.`);
    return next(event);
  });
}

export function collectTrace(records: RuntimeTraceRecord[]): (record: RuntimeTraceRecord) => void {
  return (record) => { records.push(record); };
}


/** Stable-kernel blast door: filter a blueprint before defineEngine(). */
export function applyBlastDoor<M extends EventMap>(blueprint: EngineBlueprint<M>, allowedEvents: ReadonlySet<EventName<M>>): EngineBlueprint<M> {
  return Object.freeze({ events: new Map([...blueprint.events].filter(([name]) => allowedEvents.has(name))) });
}

/** Stable-kernel origin policy for explicit rules. Kernel origins remain diagnostic labels, not authenticated identities. */
export function registerOriginAllowlistHooks<M extends EventMap>(builder: KernelBuilder<M>, pluginOrder: number, rules: Partial<Record<EventName<M>, readonly string[]>>): void {
  for (const [name, allowed] of Object.entries(rules) as [EventName<M>, readonly string[]][]) {
    builder.on("enterprise-origin-allowlist", pluginOrder, name, async (_engine, input, next) => {
      if (!allowed.includes(next.origin)) throw new Error(`Origin ${next.origin} is not permitted to call ${String(next.event)}.`);
      return next(input as never);
    });
  }
}
