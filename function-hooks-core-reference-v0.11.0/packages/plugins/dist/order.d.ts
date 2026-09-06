export interface PluginOrderNode {
    readonly name: string;
    readonly dependencies?: readonly string[];
}
export interface ManagedPluginOrder {
    readonly prepend?: readonly string[];
    readonly append?: readonly string[];
}
export declare function resolvePluginOrder(plugins: readonly PluginOrderNode[], managed?: ManagedPluginOrder): string[];
//# sourceMappingURL=order.d.ts.map