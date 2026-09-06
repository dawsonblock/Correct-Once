export interface CapabilityGrantSet {
  readonly events: readonly string[];
}

export type CapabilityGrantResolver = (pluginName: string) => CapabilityGrantSet | undefined;

function normalized(pattern: string): string {
  const value = pattern.trim();
  if (!value) throw new Error("Capability grant patterns must be non-empty strings.");
  if (value === "*") return value;
  const parts = value.split(".");
  if (parts.length !== 2 || parts.some((part) => !part)) {
    throw new Error(`Invalid capability grant pattern: ${pattern}`);
  }
  if (parts[0] === "*" && parts[1] !== "*") throw new Error(`Unsupported capability grant pattern: ${pattern}`);
  return value;
}

export function normalizeGrantSet(grants: CapabilityGrantSet | undefined): CapabilityGrantSet {
  if (!grants) return Object.freeze({ events: Object.freeze([]) });
  const events = [...new Set(grants.events.map(normalized))].sort();
  return Object.freeze({ events: Object.freeze(events) });
}

export function capabilityGranted(grants: CapabilityGrantSet, event: string): boolean {
  if (grants.events.includes("*")) return true;
  if (grants.events.includes(event)) return true;
  const dot = event.indexOf(".");
  if (dot < 1) return false;
  return grants.events.includes(`${event.slice(0, dot)}.*`);
}

export function visibleNouns(grants: CapabilityGrantSet): ReadonlySet<string> {
  if (grants.events.includes("*")) return new Set(["*"]);
  return new Set(grants.events.map((event) => event.split(".")[0]!).filter((noun) => noun !== "*"));
}
