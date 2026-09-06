// Official durable-agent-outbox ConformanceHarness driving an Effect Fabric structural
// OutboxEngine adapter. The adapter owns the public engine interface, delegates provider scheduling
// to the locked donor worker, and after every operation crosses a JSONL boundary into Effect
// Fabric's independent execution-state shadow. Any identity/fencing/transition/audit divergence
// fails the upstream scenario rather than being normalized away.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const donorRoot = process.argv[2];
const effectFabricRoot = process.argv[3];
const python = process.argv[4] || process.env.EFFECT_FABRIC_PYTHON || "python";
if (!donorRoot || !effectFabricRoot) {
  console.error("usage: node run_effect_fabric_engine.mjs <compiled-donor-root> <ef-root> [python]");
  process.exit(2);
}

const modPath = path.join(donorRoot, "packages", "conformance", "dist", "index.js");
const { createReferenceHarness, runConformance } = await import(pathToFileURL(modPath).href);

class JsonRpcProcess {
  constructor(moduleArgs, label) {
    const env = { ...process.env };
    const src = path.join(effectFabricRoot, "src");
    env.PYTHONPATH = env.PYTHONPATH ? `${src}${path.delimiter}${env.PYTHONPATH}` : src;
    this.proc = spawn(python, moduleArgs, {
      cwd: effectFabricRoot,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.label = label;
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = "";
    this.proc.stderr.setEncoding("utf8");
    this.proc.stderr.on("data", (chunk) => { this.stderr += chunk; });
    const rl = readline.createInterface({ input: this.proc.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => {
      let response;
      try { response = JSON.parse(line); }
      catch (error) { this.failAll(new Error(`invalid ${label} RPC response: ${line}: ${error}`)); return; }
      const slot = this.pending.get(response.id);
      if (!slot) return;
      this.pending.delete(response.id);
      if (response.ok) slot.resolve(response.result);
      else slot.reject(new Error(`${response.error?.type ?? "RpcError"}: ${response.error?.message}`));
    });
    this.proc.on("exit", (code, signal) => {
      if (this.closed) return;
      this.failAll(new Error(`${label} exited code=${String(code)} signal=${String(signal)}: ${this.stderr.trim()}`));
    });
  }
  failAll(error) { for (const slot of this.pending.values()) slot.reject(error); this.pending.clear(); }
  rpc(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.proc.stdin.end();
    await new Promise((resolve) => {
      const timer = setTimeout(() => { if (!this.proc.killed) this.proc.kill("SIGKILL"); resolve(); }, 2000);
      this.proc.once("exit", () => { clearTimeout(timer); resolve(); });
    });
  }
}

class PythonRpcStore {
  constructor() {
    this.tmp = fs.mkdtempSync(path.join(os.tmpdir(), "effect-fabric-dao-engine-"));
    const db = path.join(this.tmp, "store.sqlite3");
    this.rpcp = new JsonRpcProcess(
      ["-m", "effect_fabric.qualification.dao_store_server", "--db", db],
      "Effect Fabric DAO store",
    );
  }
  async loadAction(id) { const v = await this.rpcp.rpc("loadAction", { id }); return v === null ? undefined : v; }
  findBySubject(subject) { return this.rpcp.rpc("findBySubject", { subject }); }
  async findByIdempotencyKey(key) { const v = await this.rpcp.rpc("findByIdempotencyKey", { key }); return v === null ? undefined : v; }
  commit(input) { return this.rpcp.rpc("commit", { expectedRevision: input.expectedRevision, action: input.action, events: input.events }); }
  async claimNext(now) { const v = await this.rpcp.rpc("claimNext", { now }); return v === null ? undefined : v; }
  listInDoubt() { return this.rpcp.rpc("listInDoubt"); }
  listRetryable() { return this.rpcp.rpc("listRetryable"); }
  listAttempting() { return this.rpcp.rpc("listAttempting"); }
  readAudit(actionId) { return this.rpcp.rpc("readAudit", actionId === undefined ? {} : { actionId }); }
  nextAuditSeq() { return this.rpcp.rpc("nextAuditSeq"); }
  async close() { await this.rpcp.close(); fs.rmSync(this.tmp, { recursive: true, force: true }); }
}

class EffectFabricEngineAdapter {
  constructor(delegate, store) {
    this.delegate = delegate;
    this.store = store;
    this.shadow = new JsonRpcProcess(
      ["-m", "effect_fabric.qualification.dao_engine_shadow_server"],
      "Effect Fabric DAO engine shadow",
    );
    this.observations = 0;
  }
  async sync() {
    const audit = await this.store.readAudit();
    const ids = [...new Set(audit.map((row) => row.actionId))].sort();
    const actions = [];
    for (const id of ids) {
      const action = await this.store.loadAction(id);
      if (action !== undefined) actions.push(action);
    }
    const result = await this.shadow.rpc("observe", { actions, audit });
    this.observations = result.observations;
  }
  async submit(input) { const r = await this.delegate.submit(input); await this.sync(); return r; }
  async step() { const r = await this.delegate.step(); await this.sync(); return r; }
  async drain(maxSteps) { const r = await this.delegate.drain(maxSteps); await this.sync(); return r; }
  async withdraw(subject, opts) { const r = await this.delegate.withdraw(subject, opts); await this.sync(); return r; }
  async recoverAll() { const r = await this.delegate.recoverAll(); await this.sync(); return r; }
  async close() { await this.shadow.close(); }
}

let totalShadowObservations = 0;
const report = await runConformance({
  implementation: "effect-fabric:outbox-engine-interface-adapter",
  createHarness: () => {
    const store = new PythonRpcStore();
    const base = createReferenceHarness({ store });
    const worker = new EffectFabricEngineAdapter(base.worker, store);
    return {
      ...base,
      worker,
      teardown: async () => {
        totalShadowObservations += worker.observations;
        await worker.close();
        await store.close();
      },
    };
  },
});

const document = {
  schema: "effect-fabric/upstream-dao-engine-interface-runner/v1",
  adapter: {
    outbox_engine_interface: "EffectFabricEngineAdapter",
    execution_state_shadow: "effect_fabric.qualification.dao_engine_shadow.DaoEngineInvariantShadow",
    store: "effect_fabric.qualification.dao_store.DaoSqliteStoreAdapter",
    language_boundary: "typescript->jsonl-rpc->python",
    donor_tool_receipts: "official @durable-agent-outbox/conformance FakeTool",
    delegated_scheduler: "official locked @durable-agent-outbox/core OutboxWorker",
    active_effect_engine: false,
  },
  shadow_observations: totalShadowObservations,
  report,
};
process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
