export interface PluginManifest {
    readonly name: string;
    readonly version?: string;
    readonly dependencies?: readonly string[];
    readonly userConfig?: unknown;
}
export interface HooksConfig {
    readonly modules?: readonly string[];
}
export interface PluginDescriptor {
    readonly directory: string;
    readonly manifest: PluginManifest;
    readonly hooks: HooksConfig;
    readonly options?: unknown;
}
export declare function readPluginDescriptor(directory: string, options?: unknown): Promise<PluginDescriptor>;
export declare function validateDescriptor(directory: string, manifest: PluginManifest, hooks: HooksConfig): void;
//# sourceMappingURL=manifest.d.ts.map