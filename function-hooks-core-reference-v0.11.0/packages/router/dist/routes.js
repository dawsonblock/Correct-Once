export function mcpCapabilityRoute(options) {
    return Object.freeze({ app: options.app, capability: options.capability, backend: "mcp", event: "mcp.call",
        build: async (request) => ({ server: options.server, tool: options.tool, ...(options.mapArgs ? { args: await options.mapArgs(request.input, request) } : request.input === undefined ? {} : { args: request.input }) }) });
}
export function apiCapabilityRoute(options) {
    return Object.freeze({ app: options.app, capability: options.capability, backend: "api", event: "network.request",
        build: async (request) => ({ ...(await options.buildRequest(request.input, request)), ...(options.method === undefined ? {} : { method: options.method }) }) });
}
export function browserCapabilityRoute(options) {
    return Object.freeze({ app: options.app, capability: options.capability, backend: "browser", event: "browser.call",
        build: async (request) => ({ operation: options.operation, ...(options.target === undefined ? {} : { target: options.target }), ...(options.mapArgs ? { args: await options.mapArgs(request.input, request) } : request.input === undefined ? {} : { args: request.input }) }) });
}
export function desktopCapabilityRoute(options) {
    return Object.freeze({ app: options.app, capability: options.capability, backend: "desktop", event: "desktop.call",
        build: async (request) => ({ application: options.application, operation: options.operation, ...(options.target === undefined ? {} : { target: options.target }), ...(options.mapArgs ? { args: await options.mapArgs(request.input, request) } : request.input === undefined ? {} : { args: request.input }) }) });
}
export function processCapabilityRoute(options) {
    return Object.freeze({ app: options.app, capability: options.capability, backend: "local", event: "process.exec",
        build: async (request) => ({ profile: options.profile, ...(options.mapArgs ? { args: await options.mapArgs(request.input, request) } : {}), ...(options.cwd === undefined ? {} : { cwd: options.cwd }), ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) }) });
}
export function fileReadCapabilityRoute(options) {
    return Object.freeze({ app: options.app, capability: options.capability, backend: "local", event: "fs.read",
        build: async (request) => ({ path: await options.path(request.input, request) }) });
}
export function fileWriteCapabilityRoute(options) {
    return Object.freeze({ app: options.app, capability: options.capability, backend: "local", event: "fs.write",
        build: async (request) => ({ path: await options.path(request.input, request), data: await options.data(request.input, request) }) });
}
//# sourceMappingURL=routes.js.map