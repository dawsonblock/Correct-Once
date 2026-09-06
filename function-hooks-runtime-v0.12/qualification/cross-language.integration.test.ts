import assert from "node:assert/strict";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { capabilitySha256, createCapabilityCandidate } from "@function-hooks/capabilities";
import { allowAllGatewayAuthorizer, createAgentGateway } from "@function-hooks/gateway";
import {
  InMemoryRuntimeCapabilityRegistry,
  admitRuntimeCapability,
  callLockedEffectGateway,
  createEffectGatewayClient,
  createFunctionHooksRuntime,
  deriveTrustedWriteIdentity,
} from "../src/index.ts";

const READ_CAPABILITY_ID = "github.repo.read-live";
const MUTATION_CAPABILITY_ID = "github.repo.write-live";
const WRITE_CAPABILITY_ID = "github.repo.settings";
const APPROVAL_CAPABILITY_ID = "github.repo.approved-settings-live";
const DESTRUCTIVE_CAPABILITY_ID = "github.repo.purge-live";
const UNCERTAIN_CAPABILITY_ID = "github.repo.uncertain-live";

type GatewayResult = {
  readonly mode: string;
  readonly output?: unknown;
  readonly transaction_id?: string;
  readonly execution_state?: string;
  readonly verification_state?: string;
  readonly reconciliation_status?: string | null;
  readonly action_digest?: string;
};

type WriteIdentityVector = {
  readonly name: string;
  readonly subject: string;
  readonly capabilityId: string;
  readonly input: Record<string, unknown>;
  readonly idempotencyKey: string;
  readonly callerCorrelationId: string;
  readonly metadata: Record<string, string>;
  readonly semanticMetadata: Record<string, string>;
  readonly expectedActionDigest: string;
  readonly expectedTrustedIdempotencyKey: string;
  readonly expectedTrustedActionId: string;
  readonly expectedTraceId: string;
};

type ToolControlPatch = Partial<{
  readonly schema: unknown;
  readonly readOnly: boolean;
  readonly authenticated: boolean;
  readonly epoch: string | number;
  readonly mode: string;
  readonly result: unknown;
  readonly externalId: string;
  readonly statusCode: number;
  readonly approvalSecret: string;
  readonly reconcileStatus: string;
}>;

type HarnessProcess = ChildProcessByStdio<null, Readable, Readable>;

function readSchema() {
  return {
    type: "object",
    properties: {
      repo: { type: "string" },
    },
    required: ["repo"],
  };
}

function writeSchema() {
  return {
    type: "object",
    properties: {
      repo: { type: "string" },
      mode: { type: "string" },
    },
    required: ["repo", "mode"],
  };
}

function mcpImplementation(
  tool: string,
  options: { readonly attestedReadOnly?: boolean } = {},
): Parameters<typeof createCapabilityCandidate>[0]["implementation"] {
  return {
    kind: "mcp",
    server: "github",
    tool,
    ...(options.attestedReadOnly
      ? {
          descriptor: {
            authenticated: true,
            readOnly: true,
            inputSchema: readSchema(),
            epoch: "read-descriptor-v1",
          },
        }
      : {}),
  } as unknown as Parameters<typeof createCapabilityCandidate>[0]["implementation"];
}

function runtimeCapability(
  overrides: Partial<Parameters<typeof createCapabilityCandidate>[0]>,
  options: Omit<
    Parameters<typeof admitRuntimeCapability>[1],
    "admissionId" | "policyVersion" | "admittedAt"
  > & { readonly admittedAt?: string },
) {
  return admitRuntimeCapability(
    createCapabilityCandidate({
      app: "github",
      capability: "repo.read",
      description: "Read repository content",
      inputSchema: readSchema(),
      outputSchema: { type: "object" },
      sideEffect: "read",
      sensitivity: "public",
      risk: "medium",
      provenance: {
        connectorId: "github-mcp",
        connectorType: "mcp",
        discoveredAt: "2026-09-06T00:00:00.000Z",
        version: "1",
      },
      implementation: mcpImplementation("repo.read", { attestedReadOnly: true }),
      ...overrides,
    }),
    {
      admissionId: "adm-cross-language",
      policyVersion: "policy-cross-language",
      admittedAt: options.admittedAt ?? "2026-09-06T00:01:00.000Z",
      ...options,
    },
  );
}

function expectedTrustedIdempotencyKey(input: {
  readonly subject: string;
  readonly capabilityId: string;
  readonly idempotencyKey: string;
}): string {
  return capabilitySha256({
    subject: input.subject,
    capabilityId: input.capabilityId,
    idempotencyKey: input.idempotencyKey,
  });
}

function expectedUnifiedActionId(input: {
  readonly subject: string;
  readonly capabilityId: string;
  readonly idempotencyKey: string;
  readonly requestInput?: unknown;
  readonly semanticMetadata?: Readonly<Record<string, string>>;
}): string {
  const actionDigest = capabilitySha256({
    ...(input.requestInput === undefined ? {} : { input: input.requestInput }),
    ...(input.semanticMetadata === undefined ? {} : { metadata: input.semanticMetadata }),
  });
  return capabilitySha256({
    subject: input.subject,
    capabilityId: input.capabilityId,
    idempotencyKey: input.idempotencyKey,
    actionDigest,
  });
}

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to allocate a TCP port."));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const next = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(next, JSON.stringify(value), "utf8");
  await rename(next, path);
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function loadWriteIdentityVectors(): Promise<readonly WriteIdentityVector[]> {
  const path = fileURLToPath(
    new URL("../../qualification/write-identity-vectors.json", import.meta.url),
  );
  const document = JSON.parse(await readFile(path, "utf8")) as {
    readonly cases: readonly WriteIdentityVector[];
  };
  return document.cases;
}

async function waitForHealth(baseUrl: string, child: HarnessProcess): Promise<void> {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < 10_000) {
    if (child.exitCode !== null) {
      throw new Error(`Harness exited before becoming healthy.\n${lastError}`);
    }
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      if (res.ok) return;
      lastError = `${res.status} ${await res.text()}`;
    } catch (error) {
      lastError = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for harness health.\n${lastError}`);
}

async function terminate(child: HarnessProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  const exit = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const timeout = new Promise<void>((resolve) =>
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      resolve();
    }, 5_000),
  );
  await Promise.race([exit, timeout]);
}

type SnapshotState = "active" | "suspended" | "revoked";

type RuntimeFactoryOptions = Partial<
  Pick<Parameters<typeof createFunctionHooksRuntime>[0], "policyHooks" | "receipts">
>;

type HarnessContext = {
  readonly runtime: ReturnType<typeof createFunctionHooksRuntime>;
  readonly client: ReturnType<typeof createEffectGatewayClient>;
  readonly snapshotPath: string;
  readonly controlPath: string;
  makeRuntime(options?: RuntimeFactoryOptions): ReturnType<typeof createFunctionHooksRuntime>;
  callCount(): Promise<number>;
  effectFabricEnvironment(): Promise<{
    readonly effect_fabric_version: string;
    readonly effect_fabric_module: string;
  }>;
  getTransaction(transactionId: string): Promise<any>;
  writeSnapshotState(capabilityId: string, state: SnapshotState): Promise<void>;
  writeToolSchema(toolKey: string, schema: unknown): Promise<void>;
  patchToolControl(toolKey: string, patch: ToolControlPatch): Promise<void>;
  restoreDefaultControl(): Promise<void>;
  close(): Promise<void>;
};

function defaultControl() {
  return {
    tools: {
      "github/repo.read": {
        schema: readSchema(),
        authenticated: true,
        readOnly: true,
        epoch: "read-descriptor-v1",
        mode: "success",
        result: { repo: "acme/example" },
      },
      "github/repo.write": {
        schema: writeSchema(),
        mode: "success",
        result: { updated: true, path: "guarded" },
      },
      "github/repo.settings": {
        schema: writeSchema(),
        mode: "success",
        result: { updated: true },
      },
      "github/repo.approved-settings": {
        schema: writeSchema(),
        mode: "success",
        result: { updated: true, approved: true },
        approvalSecret: "live-approval-secret",
      },
      "github/repo.purge": {
        schema: readSchema(),
        mode: "success",
        result: { purged: true },
      },
      "github/repo.uncertain": {
        schema: writeSchema(),
        mode: "ambiguous_after_effect",
        reconcileStatus: "happened",
      },
    },
  };
}

function defaultReceipts() {
  return {
    onStart: () => {},
    onSuccess: () => {},
    onFailure: () => {},
  };
}

async function createHarness(): Promise<HarnessContext> {
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  const harnessPath = fileURLToPath(new URL("./live_effect_gateway_harness.py", import.meta.url));
  const tempRoot = await mkdtemp(join(tmpdir(), "correct-once-xlang-"));
  const snapshotPath = join(tempRoot, "runtime-snapshot.json");
  const controlPath = join(tempRoot, "gateway-control.json");
  const token = `cross-language-${Math.random().toString(16).slice(2)}`;
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const pythonBinary = process.env.EFFECT_FABRIC_TEST_PYTHON ?? "python3";

  const registry = new InMemoryRuntimeCapabilityRegistry();
  await registry.register(
    runtimeCapability(
      {
        id: READ_CAPABILITY_ID,
        capability: "repo.read-live",
        description: "Live read qualification capability",
        inputSchema: readSchema(),
        sideEffect: "read",
        implementation: mcpImplementation("repo.read", { attestedReadOnly: true }),
      },
      {
        executionClass: "read",
        policyHookId: "read-auth",
        requiresLightweightAuth: true,
        trustedRead: false,
      },
    ),
  );
  await registry.register(
    runtimeCapability(
      {
        id: MUTATION_CAPABILITY_ID,
        capability: "repo.write-live",
        description: "Live guarded write qualification capability",
        inputSchema: writeSchema(),
        sideEffect: "write",
        implementation: mcpImplementation("repo.write"),
      },
      {
        executionClass: "mutation",
        requiresLightweightAuth: false,
      },
    ),
  );
  await registry.register(
    runtimeCapability(
      {
        id: WRITE_CAPABILITY_ID,
        capability: "repo.settings",
        description: "Canonical critical write qualification capability",
        inputSchema: writeSchema(),
        sideEffect: "write",
        implementation: mcpImplementation("repo.settings"),
      },
      {
        executionClass: "critical",
        requiresLightweightAuth: false,
      },
    ),
  );
  await registry.register(
    runtimeCapability(
      {
        id: APPROVAL_CAPABILITY_ID,
        capability: "repo.approved-settings-live",
        description: "Live approval-gated qualification capability",
        inputSchema: writeSchema(),
        sideEffect: "write",
        implementation: mcpImplementation("repo.approved-settings"),
      },
      {
        executionClass: "critical",
        requiresLightweightAuth: false,
      },
    ),
  );
  await registry.register(
    runtimeCapability(
      {
        id: DESTRUCTIVE_CAPABILITY_ID,
        capability: "repo.purge-live",
        description: "Live destructive qualification capability",
        inputSchema: readSchema(),
        sideEffect: "destructive",
        implementation: mcpImplementation("repo.purge"),
      },
      {
        executionClass: "critical",
        requiresLightweightAuth: false,
      },
    ),
  );
  await registry.register(
    runtimeCapability(
      {
        id: UNCERTAIN_CAPABILITY_ID,
        capability: "repo.uncertain-live",
        description: "Live ambiguous provider qualification capability",
        inputSchema: writeSchema(),
        sideEffect: "write",
        implementation: mcpImplementation("repo.uncertain"),
      },
      {
        executionClass: "critical",
        requiresLightweightAuth: false,
      },
    ),
  );

  await writeJsonAtomic(snapshotPath, await registry.snapshot());
  await writeJsonAtomic(controlPath, defaultControl());

  let stderr = "";
  const child = spawn(
    pythonBinary,
    [harnessPath, "--snapshot", snapshotPath, "--control", controlPath, "--token", token, "--port", String(port)],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        PYTHONPATH: repoRoot,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  await waitForHealth(baseUrl, child);

  const mcpCall = async (input: {
    readonly server: string;
    readonly tool: string;
    readonly args?: unknown;
  }) => {
    const res = await fetch(`${baseUrl}/bridge/mcp-call`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        server: input.server,
        tool: input.tool,
        ...(input.args === undefined ? {} : { arguments: input.args }),
      }),
    });
    const body = await res.text();
    assert.equal(res.status, 200, body);
    return JSON.parse(body);
  };

  const fastGateway = await createAgentGateway({
    receipts: false,
    authorizer: allowAllGatewayAuthorizer(),
    adapters: {
      "mcp.call": mcpCall,
    },
  });
  const client = createEffectGatewayClient({
    baseUrl,
    bearerToken: token,
  });
  const readDescriptorAuthority = {
    describeTool: async (server: string, tool: string) => {
      const control = await readJson<{
        readonly tools?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
      }>(controlPath);
      const config = control.tools?.[`${server}/${tool}`];
      assert.ok(config, `Missing control descriptor for ${server}/${tool}`);
      const epoch = config.epoch;
      assert.ok(
        typeof epoch === "string" || typeof epoch === "number",
        `Missing descriptor epoch for ${server}/${tool}`,
      );
      return {
        server,
        tool,
        inputSchema: config.schema ?? {},
        authenticated: config.authenticated === true,
        readOnly: config.readOnly === true,
        epoch,
      };
    },
  } satisfies NonNullable<
    Parameters<typeof createFunctionHooksRuntime>[0]["mcpReadDescriptorAuthority"]
  >;
  const runtimes: ReturnType<typeof createFunctionHooksRuntime>[] = [];
  const makeRuntime = (options: RuntimeFactoryOptions = {}) => {
    const runtime = createFunctionHooksRuntime({
      registry,
      fastGateway,
      effectGateway: client,
      mcpReadDescriptorAuthority: readDescriptorAuthority,
      policyHooks:
        options.policyHooks ?? {
          "read-auth": () => {},
        },
      receipts: options.receipts ?? defaultReceipts(),
    });
    runtimes.push(runtime);
    return runtime;
  };
  const runtime = makeRuntime();

  const readCalls = async (): Promise<{ count: number; calls: unknown[] }> => {
    const res = await fetch(`${baseUrl}/debug/calls`);
    const body = await res.text();
    assert.equal(res.status, 200, body);
    return JSON.parse(body) as { count: number; calls: unknown[] };
  };
  const effectFabricEnvironment = async (): Promise<{
    readonly effect_fabric_version: string;
    readonly effect_fabric_module: string;
  }> => {
    const res = await fetch(`${baseUrl}/debug/environment`);
    const body = await res.text();
    assert.equal(res.status, 200, body);
    return JSON.parse(body) as {
      readonly effect_fabric_version: string;
      readonly effect_fabric_module: string;
    };
  };

  return {
    runtime,
    client,
    snapshotPath,
    controlPath,
    makeRuntime,
    callCount: async () => (await readCalls()).count,
    effectFabricEnvironment,
    getTransaction: async (transactionId: string) => {
      const res = await fetch(`${baseUrl}/debug/transactions/${transactionId}`);
      const body = await res.text();
      assert.equal(res.status, 200, body);
      return JSON.parse(body);
    },
    writeSnapshotState: async (capabilityId: string, state: SnapshotState) => {
      const snapshot = await readJson<any>(snapshotPath);
      const record = snapshot.records.find(
        (candidate: any) => candidate.capability?.capability?.id === capabilityId,
      );
      assert.ok(record, `Missing snapshot record for ${capabilityId}`);
      record.state = state;
      record.stateVersion = (record.stateVersion ?? 0) + 1;
      await writeJsonAtomic(snapshotPath, snapshot);
    },
    writeToolSchema: async (toolKey: string, schema: unknown) => {
      const control = await readJson<any>(controlPath);
      assert.ok(control.tools?.[toolKey], `Missing control tool ${toolKey}`);
      control.tools[toolKey].schema = schema;
      await writeJsonAtomic(controlPath, control);
    },
    patchToolControl: async (toolKey: string, patch: ToolControlPatch) => {
      const control = await readJson<any>(controlPath);
      assert.ok(control.tools?.[toolKey], `Missing control tool ${toolKey}`);
      control.tools[toolKey] = {
        ...control.tools[toolKey],
        ...patch,
      };
      await writeJsonAtomic(controlPath, control);
    },
    restoreDefaultControl: async () => {
      await writeJsonAtomic(controlPath, defaultControl());
    },
    close: async () => {
      for (const createdRuntime of runtimes.reverse()) {
        await createdRuntime.close();
      }
      await fastGateway.close();
      await terminate(child);
      await rm(tempRoot, { recursive: true, force: true });
      if (child.exitCode !== 0 && child.exitCode !== null) {
        throw new Error(`Harness exited with ${child.exitCode}\n${stderr}`);
      }
    },
  };
}

async function withHarness(
  callback: (context: HarnessContext) => Promise<void>,
): Promise<void> {
  const context = await createHarness();
  try {
    await callback(context);
  } finally {
    await context.close();
  }
}

test("live cross-language read stays a passthrough read", async () => {
  await withHarness(async ({ client, callCount }) => {
    const before = await callCount();
    const result = (await callLockedEffectGateway(client, {
      subject: "reader-1",
      server: "github",
      tool: "repo.read",
      args: { repo: "acme/example" },
    })) as GatewayResult;
    assert.equal(result.mode, "passthrough_read");
    assert.deepEqual(result.output, { repo: "acme/example" });
    assert.equal((await callCount()) - before, 1);
  });
});

test("live harness proves the installed effect-fabric environment", async () => {
  await withHarness(async ({ effectFabricEnvironment }) => {
    const environment = await effectFabricEnvironment();
    assert.equal(environment.effect_fabric_version, "0.2.12");
    if (process.env.EFFECT_FABRIC_EXPECT_WHEEL === "1") {
      assert.match(environment.effect_fabric_module, /site-packages/);
      assert.equal(
        environment.effect_fabric_module.includes(
          "/effect-fabric-v0.2.12/source/effect-fabric-0.2.12/src/",
        ),
        false,
      );
    }
  });
});

test("live guarded write uses the cross-language MCP path", async () => {
  await withHarness(async ({ runtime, callCount }) => {
    const before = await callCount();
    const result = await runtime.invokeCapability(
      {
        id: MUTATION_CAPABILITY_ID,
        actionId: "guarded-write-1",
        idempotencyKey: "guarded-write-1",
        input: { repo: "acme/example", mode: "guarded" },
      },
      { subject: "tenant-a" },
    );
    assert.deepEqual(result, { updated: true, path: "guarded" });
    assert.equal((await callCount()) - before, 1);
  });
});

test("live critical write stores trusted identity in Effect Fabric and replays idempotently", async () => {
  await withHarness(async ({ runtime, callCount, getTransaction }) => {
    const request = {
      id: WRITE_CAPABILITY_ID,
      callerCorrelationId: "caller-visible-action",
      idempotencyKey: "write-live-1",
      input: { repo: "acme/example", mode: "strict" },
    };
    const before = await callCount();
    const first = (await runtime.invokeCapability(request, {
      subject: "tenant-a",
    })) as GatewayResult;
    assert.equal(first.mode, "governed_effect");
    assert.equal(first.execution_state, "receipt_recorded");
    assert.ok(first.transaction_id);

    const tx = await getTransaction(first.transaction_id);
    const expectedActionId = expectedUnifiedActionId({
      subject: "tenant-a",
      capabilityId: WRITE_CAPABILITY_ID,
      idempotencyKey: "write-live-1",
      requestInput: { repo: "acme/example", mode: "strict" },
    });
    const expectedIdempotency = expectedTrustedIdempotencyKey({
      subject: "tenant-a",
      capabilityId: WRITE_CAPABILITY_ID,
      idempotencyKey: "write-live-1",
    });
    assert.equal(tx.intent.intent_id, expectedActionId);
    assert.equal(tx.intent.trace_id, "caller-visible-action");
    assert.equal(tx.idempotency.key, expectedIdempotency);

    const replay = (await runtime.invokeCapability(
      { ...request, callerCorrelationId: "caller-visible-replay" },
      { subject: "tenant-a" },
    )) as GatewayResult;
    assert.equal(replay.transaction_id, first.transaction_id);
    assert.equal((await callCount()) - before, 1);
  });
});

test("live shared write identity vectors survive the runtime-to-wheel gateway path", async () => {
  const vectors = await loadWriteIdentityVectors();
  for (const vector of vectors) {
    await withHarness(async ({ runtime, getTransaction }) => {
      const derived = deriveTrustedWriteIdentity({
        subject: vector.subject,
        capabilityId: vector.capabilityId,
        request: {
          id: vector.capabilityId,
          callerCorrelationId: vector.callerCorrelationId,
          idempotencyKey: vector.idempotencyKey,
          input: { ...vector.input },
          metadata: vector.metadata,
          semanticMetadata: vector.semanticMetadata,
        },
      });
      assert.equal(derived.actionDigest, vector.expectedActionDigest);
      assert.equal(derived.trustedIdempotencyKey, vector.expectedTrustedIdempotencyKey);
      assert.equal(derived.trustedActionId, vector.expectedTrustedActionId);
      assert.equal(derived.traceId, vector.expectedTraceId);

      const result = (await runtime.invokeCapability(
        {
          id: vector.capabilityId,
          callerCorrelationId: vector.callerCorrelationId,
          idempotencyKey: vector.idempotencyKey,
          input: { ...vector.input },
          metadata: vector.metadata,
          semanticMetadata: vector.semanticMetadata,
        },
        { subject: vector.subject },
      )) as GatewayResult;
      assert.equal(result.mode, "governed_effect");
      assert.ok(result.transaction_id);

      const tx = await getTransaction(result.transaction_id);
      assert.equal(tx.idempotency.key, vector.expectedTrustedIdempotencyKey);
      assert.equal(tx.intent.intent_id, vector.expectedTrustedActionId);
      assert.equal(tx.intent.trace_id, vector.expectedTraceId);
      const expectedSemanticMetadata =
        Object.keys(vector.semanticMetadata).length === 0
          ? null
          : { ...vector.semanticMetadata };
      assert.deepEqual(tx.intent.semantic_metadata ?? null, expectedSemanticMetadata);
    });
  }
});

test("live approval-gated critical write requires a valid approval token", async () => {
  await withHarness(async ({ runtime, callCount, getTransaction }) => {
    const before = await callCount();
    await assert.rejects(async () => {
      await runtime.invokeCapability(
        {
          id: APPROVAL_CAPABILITY_ID,
          actionId: "approval-missing",
          idempotencyKey: "approval-missing",
          input: { repo: "acme/example", mode: "approved" },
        },
        { subject: "tenant-a" },
      );
    }, /409|approval/i);
    assert.equal((await callCount()) - before, 0);

    const approved = (await runtime.invokeCapability(
      {
        id: APPROVAL_CAPABILITY_ID,
        actionId: "approval-granted",
        idempotencyKey: "approval-granted",
        input: { repo: "acme/example", mode: "approved" },
      },
      { subject: "tenant-a", approvalToken: "live-approval-secret" },
    )) as GatewayResult;
    assert.equal(approved.execution_state, "receipt_recorded");
    assert.ok(approved.transaction_id);
    assert.equal((await callCount()) - before, 1);
    const tx = await getTransaction(approved.transaction_id);
    assert.ok(tx.approval_digest);
  });
});

test("live critical replay survives a fresh runtime instance without a second external call", async () => {
  await withHarness(async ({ runtime, makeRuntime, callCount }) => {
    const request = {
      id: WRITE_CAPABILITY_ID,
      actionId: "restart-first",
      idempotencyKey: "restart-shared",
      input: { repo: "acme/example", mode: "restart" },
    };
    const before = await callCount();
    const first = (await runtime.invokeCapability(request, {
      subject: "tenant-a",
    })) as GatewayResult;
    assert.ok(first.transaction_id);

    const restartedRuntime = makeRuntime();
    const replay = (await restartedRuntime.invokeCapability(
      {
        ...request,
        actionId: "restart-second",
      },
      { subject: "tenant-a" },
    )) as GatewayResult;
    assert.equal(replay.transaction_id, first.transaction_id);
    assert.equal((await callCount()) - before, 1);
  });
});

test("live receipt persistence failure after guarded success blocks retry without a second external call", async () => {
  await withHarness(async ({ makeRuntime, callCount }) => {
    let successCalls = 0;
    const runtime = makeRuntime({
      receipts: {
        onStart: () => {},
        onSuccess: () => {
          successCalls += 1;
          throw new Error("receipt write failed after external effect");
        },
        onFailure: () => {},
      },
    });
    const invoke = (actionId: string) =>
      runtime.invokeCapability(
        {
          id: MUTATION_CAPABILITY_ID,
          actionId,
          idempotencyKey: "receipt-failure",
          input: { repo: "acme/example", mode: "pending-receipt" },
        },
        { subject: "tenant-a" },
      );

    const before = await callCount();
    await assert.rejects(async () => {
      await invoke("receipt-failure-1");
    }, /NEEDS_RECONCILIATION|receipt write failed/);
    await assert.rejects(async () => {
      await invoke("receipt-failure-2");
    }, /NEEDS_RECONCILIATION|receipt write failed/);
    assert.equal((await callCount()) - before, 1);
    assert.equal(successCalls, 1);
  });
});

test("live same key different payload conflicts and different subjects stay isolated", async () => {
  await withHarness(async ({ runtime, callCount }) => {
    const before = await callCount();
    await runtime.invokeCapability(
      {
        id: WRITE_CAPABILITY_ID,
        actionId: "same-key-first",
        idempotencyKey: "same-key",
        input: { repo: "acme/example", mode: "strict" },
      },
      { subject: "tenant-a" },
    );
    await assert.rejects(async () => {
      await runtime.invokeCapability(
        {
          id: WRITE_CAPABILITY_ID,
          actionId: "same-key-second",
          idempotencyKey: "same-key",
          input: { repo: "acme/example", mode: "relaxed" },
        },
        { subject: "tenant-a" },
      );
    }, /409/);
    assert.equal((await callCount()) - before, 1);

    const afterConflict = await callCount();
    const tenantA = (await runtime.invokeCapability(
      {
        id: WRITE_CAPABILITY_ID,
        actionId: "subject-a",
        idempotencyKey: "subject-shared",
        input: { repo: "acme/example", mode: "shared" },
      },
      { subject: "tenant-a" },
    )) as GatewayResult;
    const tenantB = (await runtime.invokeCapability(
      {
        id: WRITE_CAPABILITY_ID,
        actionId: "subject-b",
        idempotencyKey: "subject-shared",
        input: { repo: "acme/example", mode: "shared" },
      },
      { subject: "tenant-b" },
    )) as GatewayResult;
    assert.notEqual(tenantA.transaction_id, tenantB.transaction_id);
    assert.equal((await callCount()) - afterConflict, 2);
  });
});

test("live destructive gate stays off by default and allows explicitly", async () => {
  await withHarness(async ({ runtime, callCount }) => {
    const before = await callCount();
    await assert.rejects(async () => {
      await runtime.invokeCapability(
        {
          id: DESTRUCTIVE_CAPABILITY_ID,
          actionId: "destructive-off",
          idempotencyKey: "destructive-off",
          input: { repo: "acme/example" },
        },
        { subject: "tenant-a" },
      );
    }, /allowDestructive/);
    assert.equal((await callCount()) - before, 0);

    const allowed = (await runtime.invokeCapability(
      {
        id: DESTRUCTIVE_CAPABILITY_ID,
        actionId: "destructive-on",
        idempotencyKey: "destructive-on",
        input: { repo: "acme/example" },
      },
      { subject: "tenant-a", allowDestructive: true },
    )) as GatewayResult;
    assert.equal(allowed.execution_state, "receipt_recorded");
    assert.equal((await callCount()) - before, 1);
  });
});

test("live schema drift and authoritative suspension or revocation are denied", async () => {
  await withHarness(
    async ({ runtime, callCount, writeToolSchema, restoreDefaultControl, writeSnapshotState }) => {
      const before = await callCount();
      await writeToolSchema("github/repo.settings", {
        type: "object",
        properties: {
          repo: { type: "integer" },
          mode: { type: "string" },
        },
        required: ["repo", "mode"],
      });
      await assert.rejects(async () => {
        await runtime.invokeCapability(
          {
            id: WRITE_CAPABILITY_ID,
            actionId: "schema-drift",
            idempotencyKey: "schema-drift",
            input: { repo: "acme/example", mode: "strict" },
          },
          { subject: "tenant-a" },
        );
      }, /403/);
      assert.equal((await callCount()) - before, 0);
      await restoreDefaultControl();

      await writeSnapshotState(WRITE_CAPABILITY_ID, "suspended");
      await assert.rejects(async () => {
        await runtime.invokeCapability(
          {
            id: WRITE_CAPABILITY_ID,
            actionId: "suspended",
            idempotencyKey: "suspended",
            input: { repo: "acme/example", mode: "strict" },
          },
          { subject: "tenant-a" },
        );
      }, /403/);

      await writeSnapshotState(WRITE_CAPABILITY_ID, "revoked");
      await assert.rejects(async () => {
        await runtime.invokeCapability(
          {
            id: WRITE_CAPABILITY_ID,
            actionId: "revoked",
            idempotencyKey: "revoked",
            input: { repo: "acme/example", mode: "strict" },
          },
          { subject: "tenant-a" },
        );
      }, /403/);
      assert.equal((await callCount()) - before, 0);
    },
  );
});

test("live read descriptor drift is denied before external read I/O", async () => {
  await withHarness(async ({ runtime, callCount, patchToolControl, restoreDefaultControl }) => {
    const before = await callCount();
    const first = (await runtime.invokeCapability(
      {
        id: READ_CAPABILITY_ID,
        callerCorrelationId: "read-descriptor-first",
        input: { repo: "acme/example" },
      },
      { subject: "reader-1" },
    )) as { readonly repo: string };
    assert.deepEqual(first, { repo: "acme/example" });
    assert.equal((await callCount()) - before, 1);

    await patchToolControl("github/repo.read", {
      epoch: "read-descriptor-v2",
    });
    await assert.rejects(async () => {
      await runtime.invokeCapability(
        {
          id: READ_CAPABILITY_ID,
          callerCorrelationId: "read-descriptor-second",
          input: { repo: "acme/example" },
        },
        { subject: "reader-1" },
      );
    }, /descriptor drifted|re-admit/i);
    assert.equal((await callCount()) - before, 1);

    await restoreDefaultControl();
  });
});

test("live ambiguous provider outcomes reconcile without a second external call", async () => {
  await withHarness(async ({ runtime, callCount, getTransaction }) => {
    const before = await callCount();
    const result = (await runtime.invokeCapability(
      {
        id: UNCERTAIN_CAPABILITY_ID,
        actionId: "uncertain",
        idempotencyKey: "uncertain",
        input: { repo: "acme/example", mode: "uncertain" },
      },
      { subject: "tenant-a" },
    )) as GatewayResult;
    assert.equal(result.execution_state, "reconciled");
    assert.equal(result.reconciliation_status, "happened");
    assert.ok(result.transaction_id);
    const tx = await getTransaction(result.transaction_id);
    assert.equal(tx.execution_state, "reconciled");
    assert.equal((await callCount()) - before, 1);
  });
});
