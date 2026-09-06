// Official durable-agent-outbox ConformanceHarness driving an Effect Fabric native-kernel compatibility
// engine. The scheduling shell is compiled as EffectFabricNativeScheduler, but its decision import
// is redirected to Effect Fabric's checked-in effect_fabric_native_reduce.ts. The donor reduce()
// implementation is poisoned after compilation; any accidental call to it fails the run. Every
// proposed CAS commit also crosses the Effect Fabric pre-commit invariant gate before persistence.
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
  console.error("usage: node run_effect_fabric_native_engine.mjs <compiled-donor-root> <ef-root> [python]");
  process.exit(2);
}

const conformancePath = path.join(donorRoot, "packages", "conformance", "dist", "index.js");
const corePath = path.join(donorRoot, "packages", "core", "dist", "index.js");
const nativeWorkerPath = path.join(donorRoot, "packages", "core", "dist", "effectFabricNativeWorker.js");
const nativeReducePath = path.join(donorRoot, "packages", "core", "dist", "effectFabricNativeReduce.js");
const conformance = await import(pathToFileURL(conformancePath).href);
const core = await import(pathToFileURL(corePath).href);
const { EffectFabricNativeScheduler } = await import(pathToFileURL(nativeWorkerPath).href);
const nativeKernel = await import(pathToFileURL(nativeReducePath).href);
const {
  FakeTool,
  FAKE_RECEIPT_ISSUER,
  FAKE_RECEIPT_SECRET,
  START_AT,
  runConformance,
} = conformance;
const {
  DEFAULT_POLICY,
  ReplayWindow,
  createHmacVerifier,
  createReceiptVerifier,
} = core;

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
    this.closed = false;
    this.proc.stderr.setEncoding("utf8");
    this.proc.stderr.on("data", (chunk) => { this.stderr += chunk; });
    const rl = readline.createInterface({ input: this.proc.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => {
      let response;
      try { response = JSON.parse(line); }
      catch (error) {
        this.failAll(new Error(`invalid ${label} RPC response: ${line}: ${error}`));
        return;
      }
      const slot = this.pending.get(response.id);
      if (!slot) return;
      this.pending.delete(response.id);
      if (response.ok) slot.resolve(response.result);
      else slot.reject(new Error(`${response.error?.type ?? "RpcError"}: ${response.error?.message}`));
    });
    this.proc.on("exit", (code, signal) => {
      if (this.closed) return;
      this.failAll(
        new Error(`${label} exited code=${String(code)} signal=${String(signal)}: ${this.stderr.trim()}`),
      );
    });
  }
  failAll(error) {
    for (const slot of this.pending.values()) slot.reject(error);
    this.pending.clear();
  }
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
      const timer = setTimeout(() => {
        if (!this.proc.killed) this.proc.kill("SIGKILL");
        resolve();
      }, 2000);
      this.proc.once("exit", () => { clearTimeout(timer); resolve(); });
    });
  }
}

class PythonRpcStore {
  constructor() {
    this.tmp = fs.mkdtempSync(path.join(os.tmpdir(), "effect-fabric-dao-native-"));
    const db = path.join(this.tmp, "store.sqlite3");
    this.rpcp = new JsonRpcProcess(
      ["-m", "effect_fabric.qualification.dao_store_server", "--db", db],
      "Effect Fabric DAO store",
    );
  }
  async loadAction(id) {
    const value = await this.rpcp.rpc("loadAction", { id });
    return value === null ? undefined : value;
  }
  findBySubject(subject) { return this.rpcp.rpc("findBySubject", { subject }); }
  async findByIdempotencyKey(key) {
    const value = await this.rpcp.rpc("findByIdempotencyKey", { key });
    return value === null ? undefined : value;
  }
  commit(input) {
    return this.rpcp.rpc("commit", {
      expectedRevision: input.expectedRevision,
      action: input.action,
      events: input.events,
    });
  }
  async claimNext(now) {
    const value = await this.rpcp.rpc("claimNext", { now });
    return value === null ? undefined : value;
  }
  listInDoubt() { return this.rpcp.rpc("listInDoubt"); }
  listRetryable() { return this.rpcp.rpc("listRetryable"); }
  listAttempting() { return this.rpcp.rpc("listAttempting"); }
  readAudit(actionId) {
    return this.rpcp.rpc("readAudit", actionId === undefined ? {} : { actionId });
  }
  nextAuditSeq() { return this.rpcp.rpc("nextAuditSeq"); }
  async close() {
    await this.rpcp.close();
    fs.rmSync(this.tmp, { recursive: true, force: true });
  }
}

class EffectFabricGuardedStore {
  constructor(base) {
    this.base = base;
    this.guard = new JsonRpcProcess(
      ["-m", "effect_fabric.qualification.dao_active_guard_server"],
      "Effect Fabric native DAO pre-commit guard",
    );
    this.guardChecks = 0;
  }
  loadAction(id) { return this.base.loadAction(id); }
  findBySubject(subject) { return this.base.findBySubject(subject); }
  findByIdempotencyKey(key) { return this.base.findByIdempotencyKey(key); }
  claimNext(now) { return this.base.claimNext(now); }
  listInDoubt() { return this.base.listInDoubt(); }
  listRetryable() { return this.base.listRetryable(); }
  listAttempting() { return this.base.listAttempting(); }
  readAudit(actionId) { return this.base.readAudit(actionId); }
  nextAuditSeq() { return this.base.nextAuditSeq(); }
  async commit(input) {
    const before = await this.base.loadAction(input.action.id);
    await this.guard.rpc("validateCommit", {
      before: before ?? null,
      expectedRevision: input.expectedRevision ?? null,
      action: input.action,
      events: input.events,
    });
    this.guardChecks += 1;
    return this.base.commit(input);
  }
  async close() {
    await this.guard.close();
    await this.base.close();
  }
}

class PostOperationShadow {
  constructor(delegate, store) {
    this.delegate = delegate;
    this.store = store;
    this.shadow = new JsonRpcProcess(
      ["-m", "effect_fabric.qualification.dao_engine_shadow_server"],
      "Effect Fabric DAO execution-state shadow",
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
  async submit(input) { const value = await this.delegate.submit(input); await this.sync(); return value; }
  async step() { const value = await this.delegate.step(); await this.sync(); return value; }
  async drain(maxSteps) { const value = await this.delegate.drain(maxSteps); await this.sync(); return value; }
  async withdraw(subject, opts) {
    const value = await this.delegate.withdraw(subject, opts);
    await this.sync();
    return value;
  }
  async recoverAll() { const value = await this.delegate.recoverAll(); await this.sync(); return value; }
  async close() { await this.shadow.close(); }
}

function referenceVerifier() {
  return createReceiptVerifier({
    trustedIssuers: [FAKE_RECEIPT_ISSUER],
    verifySignature: createHmacVerifier({ [FAKE_RECEIPT_ISSUER]: FAKE_RECEIPT_SECRET }),
    replay: new ReplayWindow(),
  });
}

let totalShadowObservations = 0;
let totalGuardChecks = 0;
const report = await runConformance({
  implementation: "effect-fabric:native-transition-kernel",
  createHarness: () => {
    const baseStore = new PythonRpcStore();
    const store = new EffectFabricGuardedStore(baseStore);
    const fake = new FakeTool({});
    let clock = START_AT;
    const now = () => clock;
    const advanceMs = (ms) => { clock += ms; };
    const active = new EffectFabricNativeScheduler({
      store,
      tool: fake,
      receipts: fake,
      policy: DEFAULT_POLICY,
      now,
      workerId: "effect-fabric-active-1",
      receiptVerifier: referenceVerifier(),
    });
    const worker = new PostOperationShadow(active, store);
    return {
      store,
      tool: fake,
      receipts: fake,
      worker,
      advanceMs,
      teardown: async () => {
        totalShadowObservations += worker.observations;
        totalGuardChecks += store.guardChecks;
        await worker.close();
        await store.close();
      },
    };
  },
});

const document = {
  schema: "effect-fabric/upstream-dao-native-engine-runner/v1",
  adapter: {
    outbox_engine_interface: "EffectFabricNativeScheduler",
    native_transition_kernel: nativeKernel.EFFECT_FABRIC_NATIVE_KERNEL_VERSION,
    donor_reduce_poisoned: true,
    donor_outbox_worker_instantiated: false,
    transition_oracle: "effect_fabric_native_reduce.ts",
    precommit_enforcement: "effect_fabric.qualification.dao_active_guard.validate_commit",
    post_operation_shadow: "effect_fabric.qualification.dao_engine_shadow.DaoEngineInvariantShadow",
    store: "effect_fabric.qualification.dao_store.DaoSqliteStoreAdapter",
    language_boundary: "typescript->jsonl-rpc->python",
    donor_tool_receipts: "official @durable-agent-outbox/conformance FakeTool",
    production_effect_engine_replaced: false,
    donor_reduce_delegated: false,
  },
  native_reducer_calls: nativeKernel.EFFECT_FABRIC_NATIVE_REDUCER_METRICS.calls,
  precommit_guard_checks: totalGuardChecks,
  shadow_observations: totalShadowObservations,
  report,
};
process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
