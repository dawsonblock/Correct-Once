import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { FileActionReceiptStore } from "@function-hooks/assurance";
import { DurableAuditJournal } from "@function-hooks/audit";
import { GatewayHostPolicyError, GatewayOutputLimitError, allowAllGatewayAuthorizer, createAgentGateway, createNodeGatewayAdapters } from "@function-hooks/gateway";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function childNode(source, args) {
    const child = spawn(process.execPath, ["--input-type=module", "-e", source, ...args], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    const [code] = await once(child, "close");
    if (code !== 0)
        throw new Error(`child exited ${code}: ${stderr}`);
    return stdout.trim();
}
test("same-host stale receipt lock from a dead process is recovered immediately", async () => {
    const root = await mkdtemp(join(tmpdir(), "fh-v100-stale-lock-"));
    const path = join(root, "receipts.jsonl");
    try {
        await writeFile(path, "", "utf8");
        await writeFile(`${path}.lock`, JSON.stringify({ token: "dead", pid: 2147483647, host: hostname(), createdAt: Date.now() }), "utf8");
        const store = await FileActionReceiptStore.open(path, { sync: "none", lockTimeoutMs: 500, lockStaleMs: 60_000 });
        assert.equal((await store.begin("recovered", "mcp.call", { actionId: "recovered" })).created, true);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("receipt claims are atomic across independent Node processes", async () => {
    const root = await mkdtemp(join(tmpdir(), "fh-v100-receipt-procs-"));
    const path = join(root, "receipts.jsonl");
    const source = `import {FileActionReceiptStore} from '@function-hooks/assurance'; const s=await FileActionReceiptStore.open(process.argv[1],{sync:'none'}); const c=await s.begin('shared','mcp.call',{actionId:'shared',x:1}); process.stdout.write(c.created?'1':'0');`;
    try {
        const results = await Promise.all(Array.from({ length: 12 }, () => childNode(source, [path])));
        assert.equal(results.filter((value) => value === "1").length, 1);
        assert.equal(results.filter((value) => value === "0").length, 11);
        const reopened = await FileActionReceiptStore.open(path, { sync: "none" });
        assert.equal((await reopened.get("shared"))?.state, "started");
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("audit chain remains contiguous across independent Node processes", async () => {
    const root = await mkdtemp(join(tmpdir(), "fh-v100-audit-procs-"));
    const path = join(root, "audit.jsonl");
    const source = `import {DurableAuditJournal} from '@function-hooks/audit'; const j=await DurableAuditJournal.open(process.argv[1],{sync:'none'}); const base=Number(process.argv[2]); for(let i=0;i<12;i++) await j.append({at:base+i,origin:'child',event:'mcp.call',input:{base,i}});`;
    try {
        await Promise.all(Array.from({ length: 6 }, (_, index) => childNode(source, [path, String(index * 100)])));
        const reopened = await DurableAuditJournal.open(path, { sync: "none" });
        assert.equal(reopened.entries().length, 72);
        assert.deepEqual(reopened.verify(), { ok: true });
        assert.deepEqual(reopened.entries().map((entry) => entry.sequence), Array.from({ length: 72 }, (_, index) => index));
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("file receipt journals coordinate separately opened store instances", async () => {
    const root = await mkdtemp(join(tmpdir(), "fh-v100-receipts-"));
    const path = join(root, "receipts.jsonl");
    try {
        const stores = await Promise.all(Array.from({ length: 8 }, () => FileActionReceiptStore.open(path, { sync: "none" })));
        const claims = await Promise.all(Array.from({ length: 80 }, (_, index) => stores[index % stores.length].begin("shared", "mcp.call", { actionId: "shared", x: 1 })));
        assert.equal(claims.filter((claim) => claim.created).length, 1);
        assert.equal(claims.filter((claim) => !claim.created).length, 79);
        const lines = (await readFile(path, "utf8")).trim().split("\n").filter(Boolean);
        assert.equal(lines.length, 1);
        const reopened = await FileActionReceiptStore.open(path, { sync: "none" });
        assert.equal((await reopened.get("shared"))?.state, "started");
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("durable audit journals coordinate separately opened instances without chain forks", async () => {
    const root = await mkdtemp(join(tmpdir(), "fh-v100-audit-"));
    const path = join(root, "audit.jsonl");
    try {
        const journals = await Promise.all(Array.from({ length: 6 }, () => DurableAuditJournal.open(path, { sync: "none" })));
        await Promise.all(Array.from({ length: 240 }, (_, index) => journals[index % journals.length].append({ at: index, origin: "multi-instance", event: "mcp.call", input: { index } })));
        const reopened = await DurableAuditJournal.open(path, { sync: "none" });
        assert.equal(reopened.entries().length, 240);
        assert.deepEqual(reopened.verify(), { ok: true });
        assert.deepEqual(reopened.entries().map((entry) => entry.sequence), Array.from({ length: 240 }, (_, index) => index));
        assert.equal((await journals[0].refresh()).length, 240);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("process-group termination kills descendants after timeout", async () => {
    if (process.platform === "win32")
        return;
    const root = await mkdtemp(join(tmpdir(), "fh-v100-proctree-"));
    const marker = join(root, "grandchild-marker.txt");
    const parentScript = join(root, "parent.mjs");
    const grandchildScript = join(root, "grandchild.mjs");
    try {
        await writeFile(grandchildScript, `import {writeFileSync} from 'node:fs'; process.on('SIGTERM',()=>{}); setTimeout(()=>writeFileSync(${JSON.stringify(marker)},'escaped'),900); setInterval(()=>{},1000);`, "utf8");
        await writeFile(parentScript, `import {spawn} from 'node:child_process'; process.on('SIGTERM',()=>{}); spawn(process.execPath,[${JSON.stringify(grandchildScript)}],{stdio:'ignore'}); setInterval(()=>{},1000);`, "utf8");
        const adapters = await createNodeGatewayAdapters({ fsRoot: root, processProfiles: [{ id: "tree", executable: process.execPath, fixedArgs: [parentScript], maxTimeoutMs: 150 }], processKillGraceMs: 100, processTreeIsolation: "process-group" });
        const gateway = await createAgentGateway({ adapters, authorizer: allowAllGatewayAuthorizer(), receipts: false });
        await assert.rejects(gateway.dispatch("process.exec", { actionId: "tree-kill", profile: "tree" }), /exceeded 150ms/);
        await delay(1200);
        await assert.rejects(readFile(marker, "utf8"), (error) => error?.code === "ENOENT");
        await gateway.close();
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("secure filesystem mode anchors reads/writes and enforces file limits", async () => {
    const root = await mkdtemp(join(tmpdir(), "fh-v100-fs-"));
    const outside = await mkdtemp(join(tmpdir(), "fh-v100-outside-"));
    try {
        await mkdir(join(root, "safe"));
        await writeFile(join(outside, "secret.txt"), "secret", "utf8");
        await symlink(join(outside, "secret.txt"), join(root, "safe", "link.txt"));
        const adapters = await createNodeGatewayAdapters({ fsRoot: root, filesystemSecurity: process.platform === "linux" ? "required" : "auto", maxFileReadBytes: 8, maxFileWriteBytes: 8 });
        const gateway = await createAgentGateway({ adapters, authorizer: allowAllGatewayAuthorizer(), receipts: false });
        await gateway.dispatch("fs.write", { actionId: "write-ok", path: "safe/data.txt", data: "12345678" });
        assert.equal((await gateway.dispatch("fs.read", { actionId: "read-ok", path: "safe/data.txt" })).data, "12345678");
        await assert.rejects(gateway.dispatch("fs.read", { actionId: "read-link", path: "safe/link.txt" }), /securely open|symbolic|outside/i);
        await assert.rejects(gateway.dispatch("fs.write", { actionId: "write-link", path: "safe/link.txt", data: "bad" }), GatewayHostPolicyError);
        await assert.rejects(gateway.dispatch("fs.write", { actionId: "write-large", path: "safe/large.txt", data: "123456789" }), GatewayOutputLimitError);
        await gateway.close();
        assert.equal(await readFile(join(outside, "secret.txt"), "utf8"), "secret");
    }
    finally {
        await rm(root, { recursive: true, force: true });
        await rm(outside, { recursive: true, force: true });
    }
});
test("network adapter rejects allowlisted private destinations by default and permits explicit private test mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "fh-v100-net-"));
    const server = createServer((_req, res) => { res.end("ok"); });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
        throw new Error("unexpected server address");
    const origin = `http://127.0.0.1:${address.port}`;
    try {
        const deniedAdapters = await createNodeGatewayAdapters({ fsRoot: root, networkOrigins: [origin] });
        const denied = await createAgentGateway({ adapters: deniedAdapters, authorizer: allowAllGatewayAuthorizer(), receipts: false });
        await assert.rejects(denied.dispatch("network.request", { actionId: "ssrf-denied", url: `${origin}/` }), /prohibited address/);
        await denied.close();
        const allowedAdapters = await createNodeGatewayAdapters({ fsRoot: root, networkOrigins: [origin], networkAllowPrivateAddresses: true });
        const allowed = await createAgentGateway({ adapters: allowedAdapters, authorizer: allowAllGatewayAuthorizer(), receipts: false });
        const result = await allowed.dispatch("network.request", { actionId: "private-explicit", url: `${origin}/` });
        assert.equal(result.status, 200);
        assert.equal(result.body, "ok");
        await allowed.close();
    }
    finally {
        server.close();
        await rm(root, { recursive: true, force: true });
    }
});
//# sourceMappingURL=v100-hardening.test.js.map