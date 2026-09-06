export interface CapabilityGrantSet {
    readonly events: readonly string[];
}
export type CapabilityGrantResolver = (pluginName: string) => CapabilityGrantSet | undefined;
export declare function normalizeGrantSet(grants: CapabilityGrantSet | undefined): CapabilityGrantSet;
export declare function capabilityGranted(grants: CapabilityGrantSet, event: string): boolean;
export declare function visibleNouns(grants: CapabilityGrantSet): ReadonlySet<string>;
//# sourceMappingURL=grants.d.ts.map