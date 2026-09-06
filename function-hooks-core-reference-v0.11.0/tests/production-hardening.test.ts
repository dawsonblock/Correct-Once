import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { FunctionHooksRuntime, registerCorePlugin } from "@function-hooks/compat";
import { EventSchemaRegistry, FileActionReceiptStore, InMemoryActionReceiptStore, registerActionReceiptPlugin, schema } from "@function-hooks/assurance";
import { DurableAuditJournal, redactKeys } from "@function-hooks/audit";
import { ReplayLog, registerReplayRecorder, replayAndVerify } from "@function-hooks/replay";
import { RuntimeGenerationManager } from "@function-hooks/plugins";
import { NodePermissionProcessLoader, capabilityGranted, createPodmanLaunchBuilder, normalizeGrantSet } from "@function-hooks/isolation";

function tempPath(name: string): string {
  return `/tmp/function-hooks-${name}-${randomUUID()}.jsonl`;
}

test("capability grants are explicit, wildcard-aware, and deny by default", () => {
  const none = normalizeGrantSet(undefined);
  assert.equal(capabilityGranted(none, "ui.log"), false);
  const grants = normalizeGrantSet({ events: ["ui.log", "fs.*"] });
  assert.equal(capabilityGranted(grants, "ui.log"), true);
  assert.equal(capabilityGranted(grants, "fs.read"), true);
  assert.equal(capabilityGranted(grants, "network.fetch"), false);
});

test("isolated plugin cannot call an engine capability omitted from its grant surface", async () => {
  const runtime = new FunctionHooksRuntime();
  const loader = new NodePermissionProcessLoader(runtime, { startupTimeoutMs: 5_000, invocationTimeoutMs: 3_000 });
  const modulePath = fileURLToPath(new URL("./fixtures/isolated-plugin.js", import.meta.url));
  const module = await loader.load(modulePath, { pluginName: "grant-denied" });
  await module.register(runtime.registrar("grant-denied", 10), { prefix: "iso" });
  registerCorePlugin(runtime, 99, {
    promptSubmit: async (input) => input,
    uiLog: async () => undefined,
  });
  const $ = await runtime.start();
  await assert.rejects(() => $.prompt!.submit!({ text: "hello" }));
  await loader.close();
});

test("Podman launch plan is networkless, read-only, capability-free, and bounded", () => {
  const plan = createPodmanLaunchBuilder({ image: "node:22-alpine", memoryMb: 192, cpus: 1.5, pidsLimit: 32 })({
    pluginName: "demo",
    modulePath: "/plugins/demo/hooks/main.js",
    pluginRoot: "/plugins/demo/hooks",
    runtimeRoot: "/runtime/iso",
    workerPath: "/runtime/iso/worker-host.js",
    loaderPath: "/runtime/iso/sandbox-loader.js",
    encodedOptions: "",
    encodedGrants: "abc",
    maxOldSpaceMb: 96,
    nodeExecutable: "/usr/bin/node",
  });
  const joined = plan.args.join(" ");
  assert.equal(plan.command, "podman");
  assert.match(joined, /--network=none/);
  assert.match(joined, /--read-only/);
  assert.match(joined, /--cap-drop=ALL/);
  assert.match(joined, /--security-opt=no-new-privileges/);
  assert.match(joined, /--memory=192m/);
  assert.match(joined, /--pids-limit=32/);
  assert.match(joined, /:\/runtime:ro|:ro/);
});

test("durable audit journal survives reopen, verifies HMAC/hash chain, and redacts secrets", async () => {
  const path = tempPath("audit");
  const key = new Uint8Array([1,2,3,4,5,6,7,8]);
  try {
    const journal = await DurableAuditJournal.open(path, { hmacKey: key, redact: redactKeys(["token"]) });
    await journal.append({ at: 1, origin: "p", event: "model.call", input: { token: "secret", prompt: "x" }, result: { ok: true } });
    const reopened = await DurableAuditJournal.open(path, { hmacKey: key });
    assert.equal(reopened.entries().length, 1);
    assert.deepEqual(reopened.verify(), { ok: true });
    assert.equal((reopened.entries()[0]!.payload.input as any).token, "[REDACTED]");
  } finally { await rm(path, { force: true }); }
});

test("durable audit recovery rejects tampering", async () => {
  const path = tempPath("audit-tamper");
  try {
    const journal = await DurableAuditJournal.open(path);
    await journal.append({ at: 1, origin: "p", event: "tool.call", input: { command: "safe" }, result: { ok: true } });
    const raw = await readFile(path, "utf8") as string;
    await writeFile(path, raw.replace("safe", "evil"), "utf8");
    await assert.rejects(() => DurableAuditJournal.open(path));
  } finally { await rm(path, { force: true }); }
});

test("action receipt plugin replays completed side effects without executing them twice", async () => {
  const runtime = new FunctionHooksRuntime();
  const store = new InMemoryActionReceiptStore();
  let calls = 0;
  registerActionReceiptPlugin(runtime, 0, store, {
    events: new Set(["tool.call"]),
    actionId: (_event, input) => (input as any).command,
  });
  registerCorePlugin(runtime, 99, {
    toolCall: async (input) => ({ calls: ++calls, command: input.command }),
  });
  const $ = await runtime.start();
  const first = await $.tool!.call!({ tool: "Bash", command: "once" });
  const second = await $.tool!.call!({ tool: "Bash", command: "once" });
  assert.deepEqual(second, first);
  assert.equal(calls, 1);
});

test("action receipt plugin fails closed after an indeterminate side effect", async () => {
  const runtime = new FunctionHooksRuntime();
  const store = new InMemoryActionReceiptStore();
  let calls = 0;
  registerActionReceiptPlugin(runtime, 0, store, {
    events: new Set(["tool.call"]),
    actionId: () => "fixed-action",
  });
  registerCorePlugin(runtime, 99, {
    toolCall: async () => { calls += 1; throw new Error("adapter failed after possible effect"); },
  });
  const $ = await runtime.start();
  await assert.rejects(() => $.tool!.call!({ tool: "Bash", command: "x" }));
  await assert.rejects(() => $.tool!.call!({ tool: "Bash", command: "x" }), /indeterminate|refusing automatic re-execution/i);
  assert.equal(calls, 1);
});

test("file action receipt store survives process-style reopen", async () => {
  const path = tempPath("receipts");
  try {
    const first = await FileActionReceiptStore.open(path);
    await first.begin("a1", "tool.call", { x: 1 });
    await first.complete("a1", { ok: true });
    const second = await FileActionReceiptStore.open(path);
    const receipt = await second.get("a1");
    assert.equal(receipt?.state, "completed");
    assert.deepEqual(receipt?.result, { ok: true });
  } finally { await rm(path, { force: true }); }
});

test("schema registry negotiates highest common semantic version and migrates validated values", () => {
  const registry = new EventSchemaRegistry();
  registry.register({ event: "cache.put", version: "1.0.0", inputSchema: schema.object({ key: schema.string() }, { allowUnknown: false }) });
  registry.register({ event: "cache.put", version: "1.1.0", inputSchema: schema.object({ key: schema.string(), ttl: schema.number() }, { allowUnknown: false }) });
  registry.registerMigration({
    event: "cache.put",
    from: "1.0.0",
    to: "1.1.0",
    migrateInput: (value) => ({ ...(value as any), ttl: 60 }),
  });
  assert.equal(registry.negotiate("cache.put", ["0.9.0", "1.0.0", "1.1.0"]), "1.1.0");
  assert.deepEqual(registry.migrateInput("cache.put", "1.0.0", "1.1.0", { key: "k" }), { key: "k", ttl: 60 });
});

test("deterministic replay verifies pure/mock adapter behavior", async () => {
  const log = new ReplayLog();
  const first = new FunctionHooksRuntime();
  registerReplayRecorder(first, 0, log, { configHash: "cfg", pluginSetHash: "plugins" }, { events: new Set(["prompt.submit"]) });
  registerCorePlugin(first, 99, { promptSubmit: async ({ text }) => ({ normalized: text.trim().toUpperCase() }) });
  const $1 = await first.start();
  await $1.prompt!.submit!({ text: " hello " });
  assert.equal(log.verify().ok, true);

  const second = new FunctionHooksRuntime();
  registerCorePlugin(second, 99, { promptSubmit: async ({ text }) => ({ normalized: text.trim().toUpperCase() }) });
  await second.start();
  const record = log.records()[0]!;
  assert.deepEqual(await replayAndVerify(second, record), record.result);
});

test("runtime generation manager atomically publishes new generation and drains leased old generation", async () => {
  const manager = new RuntimeGenerationManager();
  let closedOld = 0;
  const makeRuntime = (label: string) => {
    const runtime = new FunctionHooksRuntime();
    registerCorePlugin(runtime, 99, { promptSubmit: async () => ({ label }) });
    return runtime;
  };

  await manager.activate(async () => ({ runtime: makeRuntime("old"), metadata: { version: 1 }, close: async () => { closedOld += 1; } }), {
    smoke: async (generation) => (await generation.engine.prompt!.submit!({ text: "x" }) as any).label === "old",
  });
  const lease = manager.acquire();
  await manager.activate(async () => ({ runtime: makeRuntime("new"), metadata: { version: 2 } }), {
    smoke: async (generation) => (await generation.engine.prompt!.submit!({ text: "x" }) as any).label === "new",
  });
  assert.equal(closedOld, 0);
  assert.equal((await lease.generation.engine.prompt!.submit!({ text: "x" }) as any).label, "old");
  assert.equal((await manager.current()!.engine.prompt!.submit!({ text: "x" }) as any).label, "new");
  await lease.release();
  assert.equal(closedOld, 1);
  await manager.close();
});

test("file action receipt claims are atomic under 100 concurrent begin calls", async () => {
  const path = tempPath("receipts-concurrent");
  try {
    const store = await FileActionReceiptStore.open(path, { sync: "none" });
    const claims = await Promise.all(Array.from({ length: 100 }, () => store.begin("shared-action", "tool.call", { x: 1 })));
    assert.equal(claims.filter((claim) => claim.created).length, 1);
    assert.equal(claims.filter((claim) => !claim.created).length, 99);
    const lines = ((await readFile(path, "utf8")) as string).trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 1);
    const reopened = await FileActionReceiptStore.open(path, { sync: "none" });
    assert.equal((await reopened.get("shared-action"))?.state, "started");
  } finally { await rm(path, { force: true }); }
});

test("durable audit journal serializes 1000 concurrent appends into one valid chain", async () => {
  const path = tempPath("audit-concurrent");
  try {
    const journal = await DurableAuditJournal.open(path, { sync: "none" });
    await Promise.all(Array.from({ length: 1000 }, (_, index) => journal.append({
      at: index,
      origin: "stress",
      event: "tool.call",
      input: { index },
      result: { ok: true },
    })));
    assert.equal(journal.entries().length, 1000);
    assert.deepEqual(journal.verify(), { ok: true });
    assert.deepEqual(journal.entries().map((entry) => entry.sequence), Array.from({ length: 1000 }, (_, index) => index));
    const reopened = await DurableAuditJournal.open(path, { sync: "none" });
    assert.equal(reopened.entries().length, 1000);
    assert.deepEqual(reopened.verify(), { ok: true });
  } finally { await rm(path, { force: true }); }
});
