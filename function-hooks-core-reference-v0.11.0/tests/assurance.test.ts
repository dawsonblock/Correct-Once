import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { FunctionHooksRuntime, MessageSizeError, NextMultiplicityError, DispatchTimeoutError, addEvents, registerCorePlugin } from "@function-hooks/compat";
import { SchemaValidationError, sealManagedConfig, verifyManagedConfig } from "@function-hooks/assurance";
import { HashChainAuditLedger, redactKeys } from "@function-hooks/audit";
import { admitPinnedPlugins, computePluginDigest, type PluginDescriptor } from "@function-hooks/plugins";
import { registerHashChainAuditPlugin } from "@function-hooks/enterprise";

test("core input schemas reject malformed events before host adapters run", async () => {
  let called = false;
  const runtime = new FunctionHooksRuntime();
  registerCorePlugin(runtime, 99, { toolCall: async () => { called = true; return { ok: true }; } });
  await runtime.start();
  await assert.rejects(() => runtime.dispatch("tool.call", { command: "echo hi" }), SchemaValidationError);
  assert.equal(called, false);
});

test("non-idempotent side-effect events cap next() multiplicity at one", async () => {
  const runtime = new FunctionHooksRuntime();
  const fanout = runtime.registrar("fanout", 0);
  fanout("tool.call", async (_$, event, next) => {
    await next(event);
    return next(event);
  });
  registerCorePlugin(runtime, 99, { toolCall: async (input) => input });
  const $ = await runtime.start();
  await assert.rejects(() => $.tool!.call!({ tool: "Echo" }), NextMultiplicityError);
});

test("runtime enforces serialized input size budgets", async () => {
  const runtime = new FunctionHooksRuntime({ budgets: { perEvent: { "prompt.submit": { maxInputBytes: 40 } } } });
  registerCorePlugin(runtime, 99, { promptSubmit: async (input) => input });
  const $ = await runtime.start();
  await assert.rejects(() => $.prompt!.submit!({ text: "x".repeat(100) }), MessageSizeError);
});

test("runtime deadline rejects a hung base invocation", async () => {
  const runtime = new FunctionHooksRuntime({ budgets: { perEvent: { "tool.call": { deadlineMs: 30 } } } });
  registerCorePlugin(runtime, 99, { toolCall: async () => new Promise(() => undefined) });
  const $ = await runtime.start();
  await assert.rejects(() => $.tool!.call!({ tool: "Hang" }), DispatchTimeoutError);
});

test("hash-chain audit ledger detects tampering and redacts configured keys", async () => {
  const ledger = new HashChainAuditLedger({ redact: redactKeys(["token", "password"]), hmacKey: Buffer.from("test-key") });
  const runtime = new FunctionHooksRuntime();
  registerHashChainAuditPlugin(runtime, 0, ledger);
  const base = runtime.registrar("base", 99);
  base("engine.create", async (_$, event, next) => {
    const below = await next(event);
    return addEvents(below, "base", {
      "demo.echo": async (input) => input,
    });
  });
  const $ = await runtime.start();
  await $.demo!.echo!({ token: "secret", nested: { password: "p", keep: 1 } });
  const entries = ledger.entries();
  assert.equal(entries.length, 1);
  assert.equal((entries[0]!.payload.input as any).token, "[REDACTED]");
  assert.deepEqual(ledger.verify(), { ok: true });
  const tampered = entries.map((entry, index) => index === 0 ? { ...entry, payload: { ...entry.payload, event: "tampered" } } : entry);
  const verdict = ledger.verify(tampered as any);
  assert.equal(verdict.ok, false);
});

test("managed configuration can be Ed25519-sealed and verified", () => {
  const pair = generateKeyPairSync("ed25519");
  const privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  const sealed = sealManagedConfig({
    format: "function-hooks-managed-config/v1",
    plugins: [{ name: "a", digest: "0".repeat(64) }],
    prepend: ["a"],
  }, privatePem);
  verifyManagedConfig(sealed, publicPem);
  assert.equal(sealed.algorithm, "Ed25519");
  assert.equal(sealed.sha256.length, 64);
});

test("plugin admission pins exact hook package content before code execution", async () => {
  const root = resolve(process.cwd(), `.tmp-plugin-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(resolve(root, "hooks"), { recursive: true });
  try {
    await writeFile(resolve(root, "plugin.json"), JSON.stringify({ name: "pinned" }), "utf8");
    await writeFile(resolve(root, "hooks", "hooks.json"), JSON.stringify({ modules: ["mod.js"] }), "utf8");
    await writeFile(resolve(root, "hooks", "mod.js"), "export function register(on) { on('demo.echo', async (_, e, next) => next(e)); }\n", "utf8");
    const descriptor: PluginDescriptor = {
      directory: root,
      manifest: { name: "pinned" },
      hooks: { modules: ["mod.js"] },
    };
    const digest = await computePluginDigest(descriptor);
    const sealed = sealManagedConfig({ format: "function-hooks-managed-config/v1", plugins: [{ name: "pinned", digest }] });
    const report = await admitPinnedPlugins([descriptor], sealed);
    assert.equal(report.records[0]!.admitted, true);
    await writeFile(resolve(root, "hooks", "mod.js"), "export function register() { throw new Error('changed'); }\n", "utf8");
    await assert.rejects(() => admitPinnedPlugins([descriptor], sealed));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
