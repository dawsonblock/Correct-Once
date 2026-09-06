// Drive the official durable-agent-outbox conformance suite against the Effect Fabric-owned
// SQLite OutboxStore compatibility adapter. The donor worker/reducer/tool/receipt source remain
// official upstream code; only the store port crosses the Python JSON-lines bridge.
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
  console.error(
    "usage: node run_effect_fabric_store.mjs <compiled-donor-root> <effect-fabric-root> [python]",
  );
  process.exit(2);
}

const modPath = path.join(donorRoot, "packages", "conformance", "dist", "index.js");
if (!fs.existsSync(modPath)) {
  console.error(`compiled conformance module missing: ${modPath}`);
  process.exit(2);
}
const { createReferenceHarness, runConformance } = await import(pathToFileURL(modPath).href);

class PythonRpcStore {
  constructor() {
    this.tmp = fs.mkdtempSync(path.join(os.tmpdir(), "effect-fabric-dao-store-"));
    const db = path.join(this.tmp, "store.sqlite3");
    const env = { ...process.env };
    const src = path.join(effectFabricRoot, "src");
    env.PYTHONPATH = env.PYTHONPATH ? `${src}${path.delimiter}${env.PYTHONPATH}` : src;
    this.proc = spawn(
      python,
      ["-m", "effect_fabric.qualification.dao_store_server", "--db", db],
      { cwd: effectFabricRoot, env, stdio: ["pipe", "pipe", "pipe"] },
    );
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = "";
    this.proc.stderr.setEncoding("utf8");
    this.proc.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });
    const rl = readline.createInterface({ input: this.proc.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => {
      let response;
      try {
        response = JSON.parse(line);
      } catch (error) {
        this.failAll(new Error(`invalid Effect Fabric store RPC response: ${line}: ${error}`));
        return;
      }
      const slot = this.pending.get(response.id);
      if (!slot) return;
      this.pending.delete(response.id);
      if (response.ok) slot.resolve(response.result);
      else slot.reject(new Error(`${response.error?.type ?? "StoreError"}: ${response.error?.message}`));
    });
    this.proc.on("exit", (code, signal) => {
      if (this.closed) return;
      const detail = this.stderr.trim();
      this.failAll(
        new Error(
          `Effect Fabric store server exited code=${String(code)} signal=${String(signal)}` +
            (detail ? `: ${detail}` : ""),
        ),
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

  async loadAction(id) {
    const value = await this.rpc("loadAction", { id });
    return value === null ? undefined : value;
  }
  findBySubject(subject) {
    return this.rpc("findBySubject", { subject });
  }
  async findByIdempotencyKey(key) {
    const value = await this.rpc("findByIdempotencyKey", { key });
    return value === null ? undefined : value;
  }
  commit(input) {
    return this.rpc("commit", {
      expectedRevision: input.expectedRevision,
      action: input.action,
      events: input.events,
    });
  }
  async claimNext(now) {
    const value = await this.rpc("claimNext", { now });
    return value === null ? undefined : value;
  }
  listInDoubt() {
    return this.rpc("listInDoubt");
  }
  listRetryable() {
    return this.rpc("listRetryable");
  }
  listAttempting() {
    return this.rpc("listAttempting");
  }
  readAudit(actionId) {
    return this.rpc("readAudit", actionId === undefined ? {} : { actionId });
  }
  nextAuditSeq() {
    return this.rpc("nextAuditSeq");
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
      this.proc.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    fs.rmSync(this.tmp, { recursive: true, force: true });
  }
}

const report = await runConformance({
  implementation: "effect-fabric:sqlite-store-adapter",
  createHarness: () => {
    const store = new PythonRpcStore();
    return createReferenceHarness({ store, teardown: () => store.close() });
  },
});

const document = {
  schema: "effect-fabric/upstream-dao-direct-store-runner/v1",
  adapter: {
    language_boundary: "typescript->jsonl-rpc->python",
    store: "effect_fabric.qualification.dao_store.DaoSqliteStoreAdapter",
    durability: "sqlite-wal-full-sync",
    donor_worker: "official @durable-agent-outbox/core OutboxWorker",
    donor_reducer: "official @durable-agent-outbox/core reduce",
    donor_tool_receipts: "official @durable-agent-outbox/conformance FakeTool",
  },
  report,
};
process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
