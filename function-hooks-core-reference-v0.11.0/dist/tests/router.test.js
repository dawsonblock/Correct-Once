import assert from "node:assert/strict";
import test from "node:test";
import { GatewayDeniedError, allowAllGatewayAuthorizer, createAgentGateway, createGatewayAllowlistAuthorizer } from "@function-hooks/gateway";
import { CapabilityRouteNotFoundError, DuplicateCapabilityRouteError, InvalidCapabilityRouteError, apiCapabilityRoute, browserCapabilityRoute, createExecutionRouter, desktopCapabilityRoute, mcpCapabilityRoute, processCapabilityRoute, } from "@function-hooks/router";
test("one execution router maps many applications onto reusable gateway backends", async () => {
    const seen = [];
    const gateway = await createAgentGateway({
        receipts: false,
        authorizer: createGatewayAllowlistAuthorizer({
            events: ["mcp.call", "network.request", "browser.call", "desktop.call", "process.exec"],
            mcpTools: { services: ["github.repo.read", "notion.page.read"] },
            networkOrigins: ["https://slack.example.invalid"],
            browserOperations: ["navigate"],
            desktopOperations: { vscode: ["open-file"] },
            processProfiles: ["npm-test"],
        }),
        adapters: {
            "mcp.call": async (input) => { seen.push({ event: "mcp.call", input }); return { server: input.server, tool: input.tool, args: input.args }; },
            "network.request": async (input) => { seen.push({ event: "network.request", input }); return { status: 200, statusText: "OK", headers: {}, body: "sent", url: input.url }; },
            "browser.call": async (input) => { seen.push({ event: "browser.call", input }); return { operation: input.operation, target: input.target }; },
            "desktop.call": async (input) => { seen.push({ event: "desktop.call", input }); return { application: input.application, operation: input.operation, target: input.target }; },
            "process.exec": async (input) => { seen.push({ event: "process.exec", input }); return { exitCode: 0, stdout: "tests-pass", stderr: "" }; },
        },
    });
    const router = createExecutionRouter({ gateway, routes: [
            mcpCapabilityRoute({ app: "github", capability: "repo.read", server: "services", tool: "github.repo.read" }),
            mcpCapabilityRoute({ app: "notion", capability: "page.read", server: "services", tool: "notion.page.read" }),
            apiCapabilityRoute({ app: "slack", capability: "message.post", method: "POST", buildRequest: (input) => ({ url: "https://slack.example.invalid/messages", body: JSON.stringify(input) }) }),
            browserCapabilityRoute({ app: "amazon", capability: "search", operation: "navigate", target: "https://www.amazon.ca/" }),
            desktopCapabilityRoute({ app: "vscode", capability: "file.open", application: "vscode", operation: "open-file", mapArgs: (input) => input }),
            processCapabilityRoute({ app: "code", capability: "test", profile: "npm-test" }),
        ] });
    assert.deepEqual(await router.execute({ actionId: "gh-1", app: "github", capability: "repo.read", input: { repo: "acme/x" } }), { server: "services", tool: "github.repo.read", args: { repo: "acme/x" } });
    assert.deepEqual(await router.execute({ actionId: "notion-1", app: "notion", capability: "page.read", input: { id: "page" } }), { server: "services", tool: "notion.page.read", args: { id: "page" } });
    assert.equal((await router.execute({ actionId: "slack-1", app: "slack", capability: "message.post", input: { text: "hello" } })).body, "sent");
    assert.equal((await router.execute({ actionId: "web-1", app: "amazon", capability: "search", input: { q: "keyboard" } })).operation, "navigate");
    assert.equal((await router.execute({ actionId: "desk-1", app: "vscode", capability: "file.open", input: { path: "src/index.ts" } })).application, "vscode");
    assert.equal((await router.execute({ actionId: "local-1", app: "code", capability: "test" })).stdout, "tests-pass");
    assert.equal(router.hasRoute("github", "repo.read"), true);
    assert.equal(router.hasRoute("github", "repo.delete"), false);
    assert.equal(router.listRoutes().length, 6);
    for (const entry of seen) {
        assert.equal(entry.input.metadata["function-hooks.router.app"].length > 0, true);
        assert.equal(entry.input.metadata["function-hooks.router.capability"].length > 0, true);
        assert.equal(entry.input.metadata["function-hooks.router.backend"].length > 0, true);
    }
    await gateway.close();
});
test("unknown application capabilities fail closed before reaching the gateway", async () => {
    let calls = 0;
    const gateway = await createAgentGateway({ receipts: false, authorizer: allowAllGatewayAuthorizer(), adapters: { "mcp.call": async () => { calls += 1; return null; } } });
    const router = createExecutionRouter({ gateway, routes: [mcpCapabilityRoute({ app: "github", capability: "read", server: "s", tool: "read" })] });
    await assert.rejects(router.execute({ actionId: "missing", app: "github", capability: "delete" }), CapabilityRouteNotFoundError);
    assert.equal(calls, 0);
    await gateway.close();
});
test("duplicate application capability routes are rejected at construction", async () => {
    const gateway = await createAgentGateway({ receipts: false, authorizer: allowAllGatewayAuthorizer(), adapters: {} });
    const route = mcpCapabilityRoute({ app: "github", capability: "read", server: "s", tool: "read" });
    assert.throws(() => createExecutionRouter({ gateway, routes: [route, route] }), DuplicateCapabilityRouteError);
    await gateway.close();
});
test("route builders cannot forge the gateway action identity", async () => {
    let calls = 0;
    const gateway = await createAgentGateway({ receipts: false, authorizer: allowAllGatewayAuthorizer(), adapters: { "mcp.call": async () => { calls += 1; return null; } } });
    const malicious = {
        app: "bad", capability: "forge", backend: "mcp", event: "mcp.call",
        build: () => ({ actionId: "forged", server: "s", tool: "t" }),
    };
    const router = createExecutionRouter({ gateway, routes: [malicious] });
    await assert.rejects(router.execute({ actionId: "real", app: "bad", capability: "forge" }), InvalidCapabilityRouteError);
    assert.equal(calls, 0);
    await gateway.close();
});
test("routing is not authorization and cannot bypass gateway policy", async () => {
    let calls = 0;
    const gateway = await createAgentGateway({ receipts: false, adapters: { "mcp.call": async () => { calls += 1; return null; } } });
    const router = createExecutionRouter({ gateway, routes: [mcpCapabilityRoute({ app: "github", capability: "read", server: "s", tool: "read" })] });
    await assert.rejects(router.execute({ actionId: "denied", app: "github", capability: "read" }), GatewayDeniedError);
    assert.equal(calls, 0);
    await gateway.close();
});
test("desktop operations have their own application-scoped allowlist", async () => {
    let calls = 0;
    const gateway = await createAgentGateway({
        receipts: false,
        authorizer: createGatewayAllowlistAuthorizer({ events: ["desktop.call"], desktopOperations: { vscode: ["open-file"] } }),
        adapters: { "desktop.call": async (input) => { calls += 1; return { op: input.operation }; } },
    });
    assert.deepEqual(await gateway.dispatch("desktop.call", { actionId: "open", application: "vscode", operation: "open-file", target: "x.ts" }), { op: "open-file" });
    await assert.rejects(gateway.dispatch("desktop.call", { actionId: "eval", application: "vscode", operation: "evaluate" }), GatewayDeniedError);
    await assert.rejects(gateway.dispatch("desktop.call", { actionId: "other-app", application: "terminal", operation: "open-file" }), GatewayDeniedError);
    assert.equal(calls, 1);
    await gateway.close();
});
test("route backend labels must match the gateway event they describe", async () => {
    const gateway = await createAgentGateway({ receipts: false, authorizer: allowAllGatewayAuthorizer(), adapters: {} });
    const invalid = { app: "bad", capability: "mapping", backend: "api", event: "mcp.call", build: () => ({ server: "s", tool: "t" }) };
    assert.throws(() => createExecutionRouter({ gateway, routes: [invalid] }), InvalidCapabilityRouteError);
    await gateway.close();
});
test("router provenance metadata cannot be forged by caller metadata", async () => {
    let metadata;
    const gateway = await createAgentGateway({ receipts: false, authorizer: allowAllGatewayAuthorizer(), adapters: { "mcp.call": async (input) => { metadata = input.metadata; return null; } } });
    const router = createExecutionRouter({ gateway, routes: [mcpCapabilityRoute({ app: "github", capability: "read", server: "s", tool: "read" })] });
    await router.execute({ actionId: "meta", app: "github", capability: "read", metadata: { "function-hooks.router.app": "forged", custom: "ok" } });
    assert.equal(metadata["function-hooks.router.app"], "github");
    assert.equal(metadata["function-hooks.router.capability"], "read");
    assert.equal(metadata.custom, "ok");
    await gateway.close();
});
//# sourceMappingURL=router.test.js.map