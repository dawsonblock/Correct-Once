export class SurfaceRegistry {
    #surfaces = new Map();
    register(surface) {
        if (this.#surfaces.has(surface.name))
            throw new Error(`Surface already registered: ${surface.name}`);
        this.#surfaces.set(surface.name, Object.freeze({
            ...surface,
            elements: Object.freeze({ ...surface.elements }),
            components: Object.freeze([...surface.components]),
        }));
    }
    resolve(name) {
        const surface = this.#surfaces.get(name);
        if (!surface)
            throw new Error(`Unknown UI surface: ${name}`);
        return surface;
    }
    names() {
        return Object.freeze([...this.#surfaces.keys()]);
    }
}
//# sourceMappingURL=surfaces.js.map