import assert from "node:assert/strict";
import test from "node:test";
import { CapabilityAdmissionError, CapabilityRegistryConflictError, CapabilityStateError, InMemoryCapabilityRegistry, admitCapability, createCapabilityCandidate, isAdmittedCapability, projectAgentCapabilityCatalog, } from "@function-hooks/capabilities";
import { allowAllGatewayAuthorizer, createAgentGateway } from "@function-hooks/gateway";
import { compileAdmittedCapabilityRoute, createExecutionRouterFromRegistry, mcpCapabilityRoute, } from "@function-hooks/router";
function candidate(overrides = {}) {
    return createCapabilityCandidate({
        app: "github",
        capability: "repo.read",
        description: "Read repository content",
        inputSchema: { type: "object", properties: { repo: { type: "string" } }, required: ["repo"] },
        outputSchema: { type: "object" },
        sideEffect: "read",
        sensitivity: "private",
        risk: "low",
        provenance: { connectorId: "github-mcp", connectorType: "mcp", discoveredAt: "2026-09-05T00:00:00.000Z", version: "1" },
        implementation: { kind: "mcp", server: "github", tool: "get_file_contents" },
        ...overrides,
    });
}
function admitted(overrides = {}) {
    return admitCapability(candidate(overrides), { admissionId: "adm-1", policyVersion: "policy-1", admittedAt: "2026-09-05T00:01:00.000Z" });
}
test("capability descriptor hashes are deterministic and discovery timestamps do not change candidate identity", () => {
    const a = candidate();
    const b = candidate({ provenance: { connectorId: "github-mcp", connectorType: "mcp", discoveredAt: "2026-09-06T00:00:00.000Z", version: "1" } });
    assert.equal(a.schemaHash, b.schemaHash);
    assert.equal(a.descriptorHash, b.descriptorHash);
    assert.equal(a.candidateHash, b.candidateHash);
    assert.equal(Object.isFrozen(a), true);
    assert.equal(Object.isFrozen(a.inputSchema), true);
});
test("schema changes alter semantic descriptor and candidate fingerprints", () => {
    const a = candidate();
    const b = candidate({ inputSchema: { type: "object", properties: { repo: { type: "string" }, ref: { type: "string" } }, required: ["repo"] } });
    assert.notEqual(a.schemaHash, b.schemaHash);
    assert.notEqual(a.descriptorHash, b.descriptorHash);
    assert.notEqual(a.candidateHash, b.candidateHash);
});
test("same semantic descriptor from a different connector keeps descriptor identity but changes candidate identity", () => {
    const a = candidate();
    const b = candidate({ provenance: { connectorId: "other-github", connectorType: "mcp", discoveredAt: "2026-09-05T00:00:00.000Z", version: "1" } });
    assert.equal(a.descriptorHash, b.descriptorHash);
    assert.notEqual(a.candidateHash, b.candidateHash);
});
test("admission binds the exact candidate and raw candidates are not routable", async () => {
    const raw = candidate();
    const good = admitCapability(raw, { admissionId: "adm-exact", policyVersion: "p1" });
    assert.equal(isAdmittedCapability(good), true);
    assert.throws(() => compileAdmittedCapabilityRoute(raw), CapabilityAdmissionError);
    const tampered = { ...good, candidateHash: "0".repeat(64) };
    assert.equal(isAdmittedCapability(tampered), false);
    assert.throws(() => compileAdmittedCapabilityRoute(tampered), CapabilityAdmissionError);
});
test("registry accepts admitted capabilities only and has irreversible terminal states", async () => {
    const registry = new InMemoryCapabilityRegistry();
    const cap = admitted();
    await assert.rejects(registry.register(candidate()), CapabilityAdmissionError);
    const created = await registry.register(cap);
    assert.equal(created.state, "active");
    assert.equal(created.stateVersion, 1);
    const suspended = await registry.suspend(cap.id, "maintenance");
    assert.equal(suspended.state, "suspended");
    assert.equal((await registry.activate(cap.id, "healthy")).state, "active");
    assert.equal((await registry.revoke(cap.id, "removed")).state, "revoked");
    await assert.rejects(registry.activate(cap.id), CapabilityStateError);
    await assert.rejects(registry.suspend(cap.id), CapabilityStateError);
    await assert.rejects(registry.supersede(cap.id), CapabilityStateError);
    await assert.rejects(registry.register(admitCapability(candidate({ implementation: { kind: "mcp", server: "github", tool: "different" } }), { admissionId: "adm-2", policyVersion: "p1" })), CapabilityRegistryConflictError);
});
test("agent catalog is projected from active registry records and omits backend implementation details", async () => {
    const registry = new InMemoryCapabilityRegistry();
    const active = admitted();
    const hidden = admitCapability(candidate({ id: "github.repo.delete", capability: "repo.delete", description: "Delete repo", sideEffect: "destructive", risk: "critical", implementation: { kind: "mcp", server: "github", tool: "delete_repository" } }), { admissionId: "adm-delete", policyVersion: "p1" });
    await registry.register(active);
    await registry.register(hidden);
    await registry.suspend(hidden.id, "review");
    const catalog = await projectAgentCapabilityCatalog(registry);
    assert.equal(catalog.length, 1);
    assert.equal(catalog[0]?.id, active.id);
    assert.equal("implementation" in catalog[0], false);
    assert.equal("provenance" in catalog[0], false);
    assert.equal("admission" in catalog[0], false);
});
test("router can be compiled automatically from active admitted capabilities", async () => {
    const seen = [];
    const gateway = await createAgentGateway({ receipts: false, authorizer: allowAllGatewayAuthorizer(), adapters: {
            "mcp.call": async (input) => { seen.push(input); return { tool: input.tool, args: input.args }; },
            "process.exec": async (input) => { seen.push(input); return { exitCode: 0, stdout: input.profile ?? "", stderr: "" }; },
            "fs.read": async (input) => { seen.push(input); return { data: input.path, bytes: input.path.length }; },
        } });
    const registry = new InMemoryCapabilityRegistry();
    await registry.register(admitted());
    await registry.register(admitCapability(candidate({ id: "dev.tests.run", app: "dev", capability: "tests.run", description: "Run approved tests", inputSchema: { type: "array", items: { type: "string" } }, outputSchema: {}, sideEffect: "external", sensitivity: "private", risk: "medium", provenance: { connectorId: "local", connectorType: "process-profile", version: "1" }, implementation: { kind: "process", profile: "project-tests" } }), { admissionId: "adm-tests", policyVersion: "p1" }));
    await registry.register(admitCapability(candidate({ id: "workspace.file.read", app: "workspace", capability: "file.read", description: "Read workspace file", inputSchema: { type: "string" }, sideEffect: "read", sensitivity: "private", risk: "low", provenance: { connectorId: "local", connectorType: "filesystem", version: "1" }, implementation: { kind: "filesystem.read" } }), { admissionId: "adm-read", policyVersion: "p1" }));
    const router = await createExecutionRouterFromRegistry({ gateway, registry });
    assert.deepEqual(await router.execute({ actionId: "a", app: "github", capability: "repo.read", input: { repo: "x" } }), { tool: "get_file_contents", args: { repo: "x" } });
    assert.equal((await router.execute({ actionId: "b", app: "dev", capability: "tests.run", input: ["--runInBand"] })).stdout, "project-tests");
    assert.equal((await router.execute({ actionId: "c", app: "workspace", capability: "file.read", input: "src/index.ts" })).data, "src/index.ts");
    assert.equal(seen[0].metadata["function-hooks.capability.admission-id"], "adm-1");
    assert.equal(seen[0].metadata["function-hooks.capability.id"], "github.repo.read");
    await gateway.close();
});
test("caller metadata cannot forge admitted capability provenance", async () => {
    let observed;
    const gateway = await createAgentGateway({ receipts: false, authorizer: allowAllGatewayAuthorizer(), adapters: { "mcp.call": async (input) => { observed = input.metadata; return null; } } });
    const registry = new InMemoryCapabilityRegistry();
    await registry.register(admitted());
    const router = await createExecutionRouterFromRegistry({ gateway, registry });
    await router.execute({ actionId: "m", app: "github", capability: "repo.read", metadata: { "function-hooks.capability.admission-id": "forged", custom: "ok" } });
    assert.equal(observed["function-hooks.capability.admission-id"], "adm-1");
    assert.equal(observed.custom, "ok");
    await gateway.close();
});
test("manual routes remain supported beside admitted generated routes", async () => {
    const gateway = await createAgentGateway({ receipts: false, authorizer: allowAllGatewayAuthorizer(), adapters: { "mcp.call": async (input) => input.tool } });
    const registry = new InMemoryCapabilityRegistry();
    await registry.register(admitted());
    const router = await createExecutionRouterFromRegistry({ gateway, registry, manualRoutes: [mcpCapabilityRoute({ app: "special", capability: "custom", server: "s", tool: "manual" })] });
    assert.equal(await router.execute({ actionId: "1", app: "special", capability: "custom" }), "manual");
    assert.equal(await router.execute({ actionId: "2", app: "github", capability: "repo.read" }), "get_file_contents");
    await gateway.close();
});
test("structured HTTP capabilities compile without exposing backend details in the agent catalog", async () => {
    let input;
    const gateway = await createAgentGateway({ receipts: false, authorizer: allowAllGatewayAuthorizer(), adapters: { "network.request": async (x) => { input = x; return { status: 200, statusText: "OK", headers: {}, body: "ok", url: x.url }; } } });
    const registry = new InMemoryCapabilityRegistry();
    const http = admitCapability(candidate({ id: "slack.message.post", app: "slack", capability: "message.post", description: "Post message", inputSchema: { type: "object" }, outputSchema: {}, sideEffect: "external", sensitivity: "private", risk: "medium", provenance: { connectorId: "slack-api", connectorType: "manifest", version: "1" }, implementation: { kind: "http", url: "https://slack.example.invalid/messages", method: "POST", body: "json", headers: { "x-client": "function-hooks" } } }), { admissionId: "adm-http", policyVersion: "p1" });
    await registry.register(http);
    const router = await createExecutionRouterFromRegistry({ gateway, registry });
    await router.execute({ actionId: "http", app: "slack", capability: "message.post", input: { text: "hi" } });
    assert.equal(input.url, "https://slack.example.invalid/messages");
    assert.equal(input.method, "POST");
    assert.equal(input.body, '{"text":"hi"}');
    assert.equal(input.headers["content-type"], "application/json");
    await gateway.close();
});
//# sourceMappingURL=capabilities.test.js.map