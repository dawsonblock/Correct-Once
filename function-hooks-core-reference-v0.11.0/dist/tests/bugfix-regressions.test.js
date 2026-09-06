import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalJson, FileActionReceiptStore, InMemoryActionReceiptStore } from "@function-hooks/assurance";
import { GatewayHostPolicyError, allowAllGatewayAuthorizer, createAgentGateway, createGatewayAllowlistAuthorizer, createNodeGatewayAdapters, } from "@function-hooks/gateway";
test("canonical JSON rejects exotic objects instead of hashing them as empty plain objects", () => {
    assert.throws(() => canonicalJson(new Date()), /plain objects/);
    assert.throws(() => canonicalJson(new Map([["x", 1]])), /plain objects/);
    assert.throws(() => canonicalJson(new Set([1, 2])), /plain objects/);
});
test("void gateway results can be completed and replayed by receipts", async () => {
    const root = await mkdtemp(join(tmpdir(), "fh-void-receipt-"));
    const path = join(root, "receipts.jsonl");
    let calls = 0;
    const firstStore = await FileActionReceiptStore.open(path, { sync: "none" });
    const first = await createAgentGateway({
        authorizer: allowAllGatewayAuthorizer(), receipts: { store: firstStore },
        adapters: { "mcp.call": async () => { calls += 1; return undefined; } },
    });
    assert.equal(await first.dispatch("mcp.call", { actionId: "void-action", server: "s", tool: "t" }), undefined);
    assert.equal((await firstStore.get("void-action"))?.state, "completed");
    await first.close();
    const reopened = await FileActionReceiptStore.open(path, { sync: "none" });
    const second = await createAgentGateway({
        authorizer: allowAllGatewayAuthorizer(), receipts: { store: reopened },
        adapters: { "mcp.call": async () => { calls += 1; return "should-not-run"; } },
    });
    assert.equal(await second.dispatch("mcp.call", { actionId: "void-action", server: "s", tool: "t" }), undefined);
    assert.equal(calls, 1);
    await second.close();
});
test("receipt results are immutable snapshots and caller mutation cannot corrupt replay", async () => {
    const store = new InMemoryActionReceiptStore();
    let calls = 0;
    const gateway = await createAgentGateway({
        authorizer: allowAllGatewayAuthorizer(), receipts: { store },
        adapters: { "mcp.call": async () => { calls += 1; return { nested: { x: 1 } }; } },
    });
    const first = await gateway.dispatch("mcp.call", { actionId: "snapshot", server: "s", tool: "t" });
    first.nested.x = 999;
    const replay = await gateway.dispatch("mcp.call", { actionId: "snapshot", server: "s", tool: "t" });
    assert.equal(calls, 1);
    assert.equal(replay.nested.x, 1);
    assert.equal(Object.isFrozen(replay), true);
    assert.equal(Object.isFrozen(replay.nested), true);
    await gateway.close();
});
test("file receipt recovery verifies persisted result hashes and transition order", async () => {
    const root = await mkdtemp(join(tmpdir(), "fh-receipt-integrity-"));
    const path = join(root, "receipts.jsonl");
    const store = await FileActionReceiptStore.open(path, { sync: "none" });
    await store.begin("a", "mcp.call", { actionId: "a", server: "s", tool: "t" });
    await store.complete("a", { ok: true });
    const lines = (await readFile(path, "utf8")).trimEnd().split("\n");
    const tampered = lines.map((line) => JSON.parse(line));
    tampered[1].receipt.result.ok = false;
    await writeFile(path, `${tampered.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
    await assert.rejects(FileActionReceiptStore.open(path, { sync: "none" }), /resultHash/);
    await writeFile(path, `${lines.join("\n")}\n${lines[0]}\n`, "utf8");
    await assert.rejects(FileActionReceiptStore.open(path, { sync: "none" }), /invalid completed -> started transition/);
});
test("approved policy rewrites are frozen before approval and execution", async () => {
    let seen = "";
    const gateway = await createAgentGateway({
        receipts: false,
        authorizer: (context) => ({ effect: "allow", approval: "required", rewrite: { ...context.input, tool: "safe" } }),
        approval: (context) => {
            assert.equal(Object.isFrozen(context.input), true);
            assert.throws(() => { context.input.tool = "mutated-after-validation"; });
            return true;
        },
        adapters: { "mcp.call": async (input) => { seen = input.tool; return null; } },
    });
    await gateway.dispatch("mcp.call", { actionId: "freeze-rewrite", server: "s", tool: "unsafe" });
    assert.equal(seen, "safe");
    await gateway.close();
});
test("authorization and host adapter security configuration is snapshotted at construction", async () => {
    const tools = ["safe"];
    const authorizer = createGatewayAllowlistAuthorizer({ events: ["mcp.call"], mcpTools: { local: tools } });
    tools.push("added-later");
    let calls = 0;
    const policyGateway = await createAgentGateway({
        receipts: false, authorizer,
        adapters: { "mcp.call": async () => { calls += 1; return null; } },
    });
    await assert.rejects(policyGateway.dispatch("mcp.call", { actionId: "late-policy", server: "local", tool: "added-later" }));
    assert.equal(calls, 0);
    await policyGateway.close();
    const root = await mkdtemp(join(tmpdir(), "fh-host-config-snapshot-"));
    const origins = [];
    const fixedArgs = ["-e", "process.stdout.write('safe-snapshot')"];
    const adapters = await createNodeGatewayAdapters({
        fsRoot: root,
        networkOrigins: origins,
        processProfiles: [{ id: "snapshot", executable: process.execPath, fixedArgs }],
    });
    origins.push("https://example.com");
    fixedArgs[1] = "process.stdout.write('mutated-config')";
    const hostGateway = await createAgentGateway({ receipts: false, authorizer: allowAllGatewayAuthorizer(), adapters });
    await assert.rejects(hostGateway.dispatch("network.request", { actionId: "late-origin", url: "https://example.com/" }), GatewayHostPolicyError);
    const result = await hostGateway.dispatch("process.exec", { actionId: "profile-snapshot", profile: "snapshot" });
    assert.equal(result.stdout, "safe-snapshot");
    await hostGateway.close();
});
test("timed-out processes that ignore SIGTERM are escalated and cannot keep running", async () => {
    const root = await mkdtemp(join(tmpdir(), "fh-process-escalation-"));
    const script = join(root, "ignore-term.mjs");
    const marker = join(root, "survived.txt");
    await writeFile(script, [
        "import { writeFileSync } from 'node:fs';",
        "process.on('SIGTERM', () => {});",
        `setTimeout(() => writeFileSync(${JSON.stringify(marker)}, 'survived'), 500);`,
        "setTimeout(() => process.exit(0), 2000);",
    ].join("\n"), "utf8");
    const adapters = await createNodeGatewayAdapters({
        fsRoot: root,
        processProfiles: [{ id: "ignore-term", executable: process.execPath, fixedArgs: [script], maxTimeoutMs: 200 }],
    });
    const gateway = await createAgentGateway({ receipts: false, authorizer: allowAllGatewayAuthorizer(), adapters });
    await assert.rejects(gateway.dispatch("process.exec", { actionId: "kill-escalation", profile: "ignore-term" }), /exceeded 200ms/);
    await new Promise((resolve) => setTimeout(resolve, 650));
    let survived = true;
    try {
        await readFile(marker, "utf8");
    }
    catch {
        survived = false;
    }
    assert.equal(survived, false);
    await gateway.close();
});
//# sourceMappingURL=bugfix-regressions.test.js.map