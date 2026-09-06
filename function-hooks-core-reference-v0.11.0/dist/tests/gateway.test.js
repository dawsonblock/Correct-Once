import assert from "node:assert/strict";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import test from "node:test";
import { once } from "node:events";
import { ActionReceiptConflictError, FileActionReceiptStore, IndeterminateActionError, InMemoryActionReceiptStore } from "@function-hooks/assurance";
import { HashChainAuditLedger } from "@function-hooks/audit";
import { GatewayApprovalDeniedError, GatewayDeniedError, GatewayHostPolicyError, GatewayInvalidRewriteError, GatewayOutputLimitError, allowAllGatewayAuthorizer, createAgentGateway, createGatewayAllowlistAuthorizer, createNodeGatewayAdapters, gatewayHashChainAuditSink, } from "@function-hooks/gateway";
import { DispatchCancelledError } from "@function-hooks/core";
const mcpInput = (actionId, tool = "safe") => ({ actionId, server: "local", tool, args: { x: 1 } });
test("gateway defaults to deny-all and never reaches an adapter", async () => {
    let called = 0;
    const gateway = await createAgentGateway({ adapters: { "mcp.call": async () => { called += 1; return { ok: true }; } }, receipts: false });
    await assert.rejects(gateway.dispatch("mcp.call", mcpInput("deny-default")), GatewayDeniedError);
    assert.equal(called, 0);
    await gateway.close();
});
test("policy denial and approval denial are audited before execution", async () => {
    const records = [];
    let called = 0;
    const denied = await createAgentGateway({
        adapters: { "mcp.call": async () => { called += 1; return null; } }, receipts: false,
        authorizer: () => ({ effect: "deny", reason: "blocked by test policy" }), audit: (record) => { records.push(record); },
    });
    await assert.rejects(denied.dispatch("mcp.call", mcpInput("deny-audit")), GatewayDeniedError);
    assert.equal(called, 0);
    assert.equal(records.at(-1)?.phase, "policy.denied");
    await denied.close();
    const approval = await createAgentGateway({
        adapters: { "mcp.call": async () => { called += 1; return null; } }, receipts: false,
        authorizer: () => ({ effect: "allow", approval: "required", reason: "human confirmation" }),
        approval: () => false, audit: (record) => { records.push(record); },
    });
    await assert.rejects(approval.dispatch("mcp.call", mcpInput("approval-deny")), GatewayApprovalDeniedError);
    assert.equal(called, 0);
    assert.equal(records.at(-1)?.phase, "approval.denied");
    await approval.close();
});
test("authorized rewrite is revalidated and the executor sees the effective action", async () => {
    let seen = "";
    const gateway = await createAgentGateway({
        adapters: { "mcp.call": async (input) => { seen = input.tool; return { tool: input.tool }; } }, receipts: false,
        authorizer: (context) => ({ effect: "allow", rewrite: { ...context.input, tool: "rewritten-safe" } }),
    });
    const result = await gateway.dispatch("mcp.call", mcpInput("rewrite", "unsafe"));
    assert.equal(seen, "rewritten-safe");
    assert.deepEqual(result, { tool: "rewritten-safe" });
    await gateway.close();
});
test("policy rewrites cannot replace the immutable actionId", async () => {
    let called = 0;
    const gateway = await createAgentGateway({
        adapters: { "mcp.call": async () => { called += 1; return null; } }, receipts: false,
        authorizer: (context) => ({ effect: "allow", rewrite: { ...context.input, actionId: "replacement-id" } }),
    });
    await assert.rejects(gateway.dispatch("mcp.call", mcpInput("original-id")), GatewayInvalidRewriteError);
    assert.equal(called, 0);
    await gateway.close();
});
test("receipts replay completed actions and reject action-id conflicts", async () => {
    let calls = 0;
    const store = new InMemoryActionReceiptStore();
    const records = [];
    const gateway = await createAgentGateway({
        adapters: { "mcp.call": async () => ({ call: ++calls }) }, authorizer: allowAllGatewayAuthorizer(),
        receipts: { store }, audit: (record) => { records.push(record); },
    });
    assert.deepEqual(await gateway.dispatch("mcp.call", mcpInput("receipt-1")), { call: 1 });
    assert.deepEqual(await gateway.dispatch("mcp.call", mcpInput("receipt-1")), { call: 1 });
    assert.equal(calls, 1);
    assert.equal(records.filter((r) => r.phase === "execution.start").length, 1);
    await assert.rejects(gateway.dispatch("mcp.call", mcpInput("receipt-1", "different")), ActionReceiptConflictError);
    await gateway.close();
});
test("100 simultaneous durable receipt claims execute the side effect at most once", async () => {
    const root = await mkdtemp(join(tmpdir(), "fh-gateway-receipt-race-"));
    const store = await FileActionReceiptStore.open(join(root, "receipts.jsonl"), { sync: "none" });
    let calls = 0;
    const gateway = await createAgentGateway({
        adapters: { "mcp.call": async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 20)); return { calls }; } },
        authorizer: allowAllGatewayAuthorizer(), receipts: { store },
    });
    const outcomes = await Promise.allSettled(Array.from({ length: 100 }, () => gateway.dispatch("mcp.call", mcpInput("shared-gateway-action"))));
    assert.equal(calls, 1);
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 99);
    assert.equal((await store.get("shared-gateway-action"))?.state, "completed");
    await gateway.close();
});
test("nested actions re-enter higher-authority policy and cannot bypass it", async () => {
    let networkCalls = 0;
    const gateway = await createAgentGateway({
        receipts: false,
        authorizer: ({ event }) => event === "network.request" ? ({ effect: "deny", reason: "nested network denied" }) : ({ effect: "allow" }),
        adapters: {
            "network.request": async () => { networkCalls += 1; return { status: 200, statusText: "OK", headers: {}, body: "bad", url: "https://blocked.invalid" }; },
            "process.exec": async (_input, context) => {
                await context.engine.network.request({ actionId: "nested-network", url: "https://blocked.invalid" });
                return { exitCode: 0, stdout: "", stderr: "" };
            },
        },
    });
    await assert.rejects(gateway.dispatch("process.exec", { actionId: "outer", command: "synthetic" }), GatewayDeniedError);
    assert.equal(networkCalls, 0);
    await gateway.close();
});
test("caller cancellation reaches the execution adapter but does not claim rollback", async () => {
    let started = false;
    let observedAbort = false;
    const gateway = await createAgentGateway({
        receipts: false, authorizer: allowAllGatewayAuthorizer(),
        adapters: { "mcp.call": async (_input, context) => {
                started = true;
                return new Promise((_resolve, reject) => context.signal.addEventListener("abort", () => { observedAbort = true; reject(new Error("host stopped")); }, { once: true }));
            } },
    });
    const controller = new AbortController();
    const pending = gateway.dispatch("mcp.call", mcpInput("cancel"), { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    await assert.rejects(pending, DispatchCancelledError);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(started, true);
    assert.equal(observedAbort, true);
    await gateway.close();
});
test("hash-chain gateway audit records the effective execution path", async () => {
    const ledger = new HashChainAuditLedger();
    const gateway = await createAgentGateway({
        receipts: false, authorizer: allowAllGatewayAuthorizer(), audit: gatewayHashChainAuditSink(ledger),
        adapters: { "mcp.call": async (input) => ({ tool: input.tool }) },
    });
    await gateway.dispatch("mcp.call", mcpInput("ledger"));
    assert.deepEqual(ledger.verify(), { ok: true });
    assert.deepEqual(ledger.entries().map((entry) => entry.payload.input.phase), ["execution.start", "execution.success"]);
    await gateway.close();
});
test("allowlist policy constrains MCP tools and browser operations before host callbacks", async () => {
    let mcpCalls = 0;
    let browserCalls = 0;
    const gateway = await createAgentGateway({
        receipts: false,
        authorizer: createGatewayAllowlistAuthorizer({
            events: ["mcp.call", "browser.call"],
            mcpTools: { local: ["safe"] },
            browserOperations: ["navigate"],
        }),
        adapters: {
            "mcp.call": async (input) => { mcpCalls += 1; return { tool: input.tool }; },
            "browser.call": async (input) => { browserCalls += 1; return { operation: input.operation }; },
        },
    });
    assert.deepEqual(await gateway.dispatch("mcp.call", mcpInput("mcp-safe")), { tool: "safe" });
    await assert.rejects(gateway.dispatch("mcp.call", mcpInput("mcp-unsafe", "shell")), GatewayDeniedError);
    assert.deepEqual(await gateway.dispatch("browser.call", { actionId: "browser-safe", operation: "navigate", target: "https://example.invalid" }), { operation: "navigate" });
    await assert.rejects(gateway.dispatch("browser.call", { actionId: "browser-unsafe", operation: "evaluate", args: "dangerous" }), GatewayDeniedError);
    assert.equal(mcpCalls, 1);
    assert.equal(browserCalls, 1);
    await gateway.close();
});
test("failure after an external side effect leaves the receipt indeterminate and blocks automatic retry", async () => {
    const store = new InMemoryActionReceiptStore();
    let calls = 0;
    const gateway = await createAgentGateway({
        authorizer: allowAllGatewayAuthorizer(), receipts: { store },
        adapters: { "mcp.call": async () => ({ call: ++calls }) },
        audit: (record) => { if (record.phase === "execution.success")
            throw new Error("audit persistence failed after side effect"); },
    });
    await assert.rejects(gateway.dispatch("mcp.call", mcpInput("indeterminate")));
    assert.equal(calls, 1);
    assert.equal((await store.get("indeterminate"))?.state, "indeterminate");
    await assert.rejects(gateway.dispatch("mcp.call", mcpInput("indeterminate")), IndeterminateActionError);
    assert.equal(calls, 1);
    await gateway.close();
});
test("Node adapters enforce filesystem containment and symlink escape protection", async () => {
    const root = await mkdtemp(join(tmpdir(), "fh-gateway-root-"));
    const outside = await mkdtemp(join(tmpdir(), "fh-gateway-outside-"));
    await writeFile(join(outside, "secret.txt"), "secret", "utf8");
    await symlink(join(outside, "secret.txt"), join(root, "escape-link"));
    const adapters = await createNodeGatewayAdapters({ fsRoot: root });
    const gateway = await createAgentGateway({ adapters, authorizer: allowAllGatewayAuthorizer() });
    await gateway.dispatch("fs.write", { actionId: "write", path: "ok.txt", data: "hello" });
    assert.equal((await gateway.dispatch("fs.read", { actionId: "read", path: "ok.txt" })).data, "hello");
    assert.equal(await readFile(join(root, "ok.txt"), "utf8"), "hello");
    await assert.rejects(gateway.dispatch("fs.read", { actionId: "traversal", path: "../secret.txt" }), GatewayHostPolicyError);
    await assert.rejects(gateway.dispatch("fs.read", { actionId: "symlink", path: "escape-link" }), GatewayHostPolicyError);
    await gateway.close();
});
test("Node process adapter uses capability profiles, rejects arbitrary args, and never inherits host environment", async () => {
    const root = await mkdtemp(join(tmpdir(), "fh-gateway-proc-"));
    process.env.FH_TEST_SECRET = "must-not-leak";
    try {
        const adapters = await createNodeGatewayAdapters({
            fsRoot: root,
            processProfiles: [{
                    id: "fixed-node-check",
                    executable: process.execPath,
                    fixedArgs: ["-e", "process.stdout.write((process.env.FH_ALLOWED ?? 'missing') + '|' + (process.env.FH_TEST_SECRET ?? 'hidden'))"],
                    environment: { FH_ALLOWED: "allowed" },
                    maxTimeoutMs: 2_000,
                    maxOutputBytes: 1_024,
                }],
        });
        const gateway = await createAgentGateway({ adapters, authorizer: allowAllGatewayAuthorizer() });
        const result = await gateway.dispatch("process.exec", { actionId: "proc-ok", profile: "fixed-node-check" });
        assert.equal(result.exitCode, 0);
        assert.equal(result.stdout, "allowed|hidden");
        await assert.rejects(gateway.dispatch("process.exec", { actionId: "proc-args-deny", profile: "fixed-node-check", args: ["arbitrary"] }), GatewayHostPolicyError);
        await assert.rejects(gateway.dispatch("process.exec", { actionId: "proc-profile-deny", profile: "missing-profile" }), GatewayHostPolicyError);
        await gateway.close();
    }
    finally {
        delete process.env.FH_TEST_SECRET;
    }
});
test("legacy raw process commands are denied by default and require explicit host opt-in", async () => {
    const root = await mkdtemp(join(tmpdir(), "fh-gateway-proc-legacy-"));
    const deniedAdapters = await createNodeGatewayAdapters({ fsRoot: root, processCommands: [process.execPath] });
    const deniedGateway = await createAgentGateway({ adapters: deniedAdapters, authorizer: allowAllGatewayAuthorizer() });
    await assert.rejects(deniedGateway.dispatch("process.exec", { actionId: "legacy-denied", command: process.execPath, args: ["-e", "process.stdout.write('bad')"] }), GatewayHostPolicyError);
    await deniedGateway.close();
    const legacyAdapters = await createNodeGatewayAdapters({ fsRoot: root, processCommands: [process.execPath], allowLegacyProcessCommands: true, processEnvironment: {} });
    const legacyGateway = await createAgentGateway({ adapters: legacyAdapters, authorizer: allowAllGatewayAuthorizer() });
    const result = await legacyGateway.dispatch("process.exec", { actionId: "legacy-explicit", command: process.execPath, args: ["-e", "process.stdout.write('legacy')"] });
    assert.equal(result.stdout, "legacy");
    await legacyGateway.close();
});
test("Node network adapter allows exact origins, blocks redirects by default and rejects other origins", async () => {
    const root = await mkdtemp(join(tmpdir(), "fh-gateway-net-"));
    const server = createServer((req, res) => {
        if (req.url === "/redirect") {
            res.statusCode = 302;
            res.setHeader("location", "https://example.com/");
            res.end();
            return;
        }
        if (req.url === "/large") {
            res.statusCode = 200;
            res.end("x".repeat(128));
            return;
        }
        res.statusCode = 200;
        res.setHeader("content-type", "text/plain");
        res.end("local-ok");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;
    try {
        const adapters = await createNodeGatewayAdapters({ fsRoot: root, networkOrigins: [origin], networkMethods: ["GET"], maxResponseBytes: 64, networkAllowPrivateAddresses: true });
        const gateway = await createAgentGateway({ adapters, authorizer: allowAllGatewayAuthorizer() });
        const response = await gateway.dispatch("network.request", { actionId: "net-ok", url: `${origin}/ok` });
        assert.equal(response.status, 200);
        assert.equal(response.body, "local-ok");
        const redirect = await gateway.dispatch("network.request", { actionId: "net-redirect", url: `${origin}/redirect` });
        assert.equal(redirect.status, 302);
        await assert.rejects(gateway.dispatch("network.request", { actionId: "net-large", url: `${origin}/large` }), GatewayOutputLimitError);
        await assert.rejects(gateway.dispatch("network.request", { actionId: "net-deny", url: "https://example.com/" }), GatewayHostPolicyError);
        await gateway.close();
    }
    finally {
        server.close();
        await once(server, "close");
    }
});
//# sourceMappingURL=gateway.test.js.map