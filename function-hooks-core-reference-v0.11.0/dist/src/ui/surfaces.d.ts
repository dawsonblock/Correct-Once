export interface SurfaceDefinition {
    readonly name: string;
    readonly jsx: string;
    readonly elements: Readonly<Record<string, Readonly<Record<string, string>>>>;
    readonly components: readonly string[];
}
export declare class SurfaceRegistry {
    #private;
    register(surface: SurfaceDefinition): void;
    resolve(name: string): SurfaceDefinition;
    names(): readonly string[];
}
export interface RenderEvent {
    readonly component: string;
    readonly props: unknown;
    readonly surface: string;
}
export interface ElementInteractionEvent {
    readonly plugin: string;
    readonly element: string;
    readonly component: string;
    readonly payload?: unknown;
}
//# sourceMappingURL=surfaces.d.ts.map