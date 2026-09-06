export interface SurfaceDefinition {
  readonly name: string;
  readonly jsx: string;
  readonly elements: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly components: readonly string[];
}

export class SurfaceRegistry {
  readonly #surfaces = new Map<string, SurfaceDefinition>();

  register(surface: SurfaceDefinition): void {
    if (this.#surfaces.has(surface.name)) throw new Error(`Surface already registered: ${surface.name}`);
    this.#surfaces.set(surface.name, Object.freeze({
      ...surface,
      elements: Object.freeze({ ...surface.elements }),
      components: Object.freeze([...surface.components]),
    }));
  }

  resolve(name: string): SurfaceDefinition {
    const surface = this.#surfaces.get(name);
    if (!surface) throw new Error(`Unknown UI surface: ${name}`);
    return surface;
  }

  names(): readonly string[] {
    return Object.freeze([...this.#surfaces.keys()]);
  }
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
