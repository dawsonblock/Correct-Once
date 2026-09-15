import assert from "node:assert/strict";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createCapabilityCandidate } from "@function-hooks/capabilities";
import { allowAllGatewayAuthorizer, createAgentGateway } from "@function-hooks/gateway";
import {
  InMemoryRuntimeCapabilityRegistry,
  admitRuntimeCapability,
  createEffectGatewayClient,
  createFunctionHooksRuntime,
} from "../src/index.ts";

type HarnessProcess = ChildProcessByStdio<null, Readable, Readable>;

type GatewayResult = {
  readonly mode: string;
  readonly output?: unknown;
  readonly transaction_id?: string;
  readonly execution_state?: string;
  readonly verification_state?: string;
};

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

function mcpImplementation(tool: string) {
  return {
    kind: "mcp" as const,
    server: "github",
    tool,
  };
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
      capability: "repo.settings",
      description: "Critical repository settings update",
      inputSchema: writeSchema(),
      outputSchema: { type: "object" },
      sideEffect: "write",
      sensitivity: "public",
      risk: "high",
      provenance: {
        connectorId: "github-mcp",
        connectorType: "mcp",
        discoveredAt: "2026-09-15T00:00:00.000Z",
        version: "1",
      },
      implementation: mcpImplementation("repo.settings"),
      ...overrides,
    }),
    {
      admissionId: "adm-live-gateway",
      policyVersion: "policy-live-gateway",
      admittedAt: options.admittedAt ?? "2026-09-15T00:01:00.000Z",
      ...options,
    },
  );
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

async function waitForHealth(baseUrl: string, child: HarnessProcess): Promise<void> {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < 10_000) {
    if (child.exitCode !== null) {
      throw new Error(`Gateway exited before becoming healthy.\n${lastError}`);
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
  throw new Error(`Timed out waiting for gateway health.\n${lastError}`);
}

async function terminate(child: HarnessProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const timeout = new Promise<void>((resolve) =>
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      resolve();
    }, 5_000),
  );
  await Promise.race([exited, timeout]);
}

type HarnessContext = {
  readonly runtime: ReturnType<typeof createFunctionHooksRuntime>;
  readonly baseUrl: string;
  readonly token: string;
  readonly gatewayChild: HarnessProcess;
  readonly capabilityId: string;
  writeSnapshotState(
    capabilityId: string,
    state: "active" | "suspended" | "revoked",
  ): Promise<void>;
  close(): Promise<void>;
};

async function createHarness(): Promise<HarnessContext> {
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  const fixturePath = fileURLToPath(
    new URL("./fixtures/stdio_mcp_server.mjs", import.meta.url),
  );
  const tempRoot = await mkdtemp(join(tmpdir(), "correct-once-live-gateway-"));
  const snapshotPath = join(tempRoot, "runtime-snapshot.json");
  const controlPath = join(tempRoot, "mcp-control.json");
  const token = `live-gateway-${Math.random().toString(16).slice(2)}`;
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const pythonBinary = process.env.EFFECT_FABRIC_TEST_PYTHON ?? "python3";
  const capabilityId = "github.repo.settings.live-authority";

  const registry = new InMemoryRuntimeCapabilityRegistry();
  await registry.register(
    runtimeCapability(
      {
        id: capabilityId,
        capability: "repo.settings.live-authority",
        description: "Critical repository settings authority proof",
        implementation: mcpImplementation("repo.settings"),
      },
      {
        executionClass: "critical",
        requiresLightweightAuth: false,
      },
    ),
  );

  await writeJsonAtomic(snapshotPath, await registry.snapshot());
  await writeJsonAtomic(controlPath, {
    tools: {
      "repo.settings": {
        description: "Update repository settings",
        inputSchema: writeSchema(),
        annotations: {
          destructiveHint: false,
          idempotentHint: true,
        },
        result: {
          updated: true,
          source: "stdio-mcp",
        },
      },
    },
  });

  let stderr = "";
  const pyPathPrefix = [
    repoRoot,
    `${repoRoot}/effect-fabric-v0.2.12/source/effect-fabric-0.2.12/src`,
  ].join(":");
  const gatewayChild = spawn(pythonBinary, ["-m", "correct_once_gateway.main"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PYTHONPATH: process.env.PYTHONPATH
        ? `${pyPathPrefix}:${process.env.PYTHONPATH}`
        : pyPathPrefix,
      PORT: String(port),
      EFFECT_GATEWAY_SNAPSHOT_PATH: snapshotPath,
      EFFECT_GATEWAY_TOKEN: token,
      EFFECT_GATEWAY_MCP_TRANSPORT: "stdio",
      EFFECT_GATEWAY_MCP_SERVER_NAME: "github",
      EFFECT_GATEWAY_MCP_COMMAND: process.execPath,
      EFFECT_GATEWAY_MCP_ARGS_JSON: JSON.stringify([fixturePath, controlPath]),
      EFFECT_GATEWAY_MCP_CWD: repoRoot,
      EFFECT_GATEWAY_AUTO_VERIFY: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  gatewayChild.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  await waitForHealth(baseUrl, gatewayChild);

  const fastGateway = await createAgentGateway({
    receipts: false,
    authorizer: allowAllGatewayAuthorizer(),
    adapters: {
      "mcp.call": async () => {
        throw new Error("authority proof must not use the fast path");
      },
    },
  });

  const runtime = createFunctionHooksRuntime({
    registry,
    fastGateway,
    effectGateway: createEffectGatewayClient({
      baseUrl,
      bearerToken: token,
    }),
  });

  return {
    runtime,
    baseUrl,
    token,
    gatewayChild,
    capabilityId,
    writeSnapshotState: async (targetId, state) => {
      const snapshot = await readJson<any>(snapshotPath);
      const record = snapshot.records.find(
        (candidate: any) => candidate.capability?.capability?.id === targetId,
      );
      assert.ok(record, `Missing snapshot record for ${targetId}`);
      record.state = state;
      record.stateVersion = (record.stateVersion ?? 0) + 1;
      await writeJsonAtomic(snapshotPath, snapshot);
    },
    close: async () => {
      await runtime.close();
      await fastGateway.close();
      await terminate(gatewayChild);
      await rm(tempRoot, { recursive: true, force: true });
      if (gatewayChild.exitCode !== 0 && gatewayChild.exitCode !== null) {
        throw new Error(`Gateway exited with ${gatewayChild.exitCode}\n${stderr}`);
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

test("permanent gateway requires bearer auth", async () => {
  await withHarness(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/gateway/tool-call`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        subject: "tenant-a",
        server: "github",
        tool: "repo.settings",
        arguments: { repo: "acme/example", mode: "strict" },
      }),
    });
    assert.equal(res.status, 401);
  });
});

test("live_authority_policy revokes the external critical path without restart", async () => {
  await withHarness(
    async ({ runtime, capabilityId, writeSnapshotState, baseUrl, token, gatewayChild }) => {
      const environmentRes = await fetch(`${baseUrl}/debug/environment`);
      const environment = await environmentRes.json();
      assert.equal(environmentRes.status, 200);
      assert.equal(environment.effect_fabric_version, "0.2.12");
      assert.deepEqual(environment.registered_tools, ["github/repo.settings"]);

      const first = (await runtime.invokeCapability(
        {
          id: capabilityId,
          actionId: "authority-first",
          idempotencyKey: "authority-first",
          input: { repo: "acme/example", mode: "strict" },
        },
        { subject: "tenant-a" },
      )) as GatewayResult;
      assert.equal(first.mode, "governed_effect");
      assert.equal(first.execution_state, "receipt_recorded");
      assert.deepEqual(first.output, {
        updated: true,
        source: "stdio-mcp",
      });

      await writeSnapshotState(capabilityId, "revoked");

      await assert.rejects(
        runtime.invokeCapability(
          {
            id: capabilityId,
            actionId: "authority-second",
            idempotencyKey: "authority-second",
            input: { repo: "acme/example", mode: "strict" },
          },
          { subject: "tenant-a" },
        ),
        /403|authoritative|gateway-routable|denied/i,
      );

      const directRes = await fetch(`${baseUrl}/gateway/tool-call`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          subject: "tenant-a",
          server: "github",
          tool: "repo.settings",
          arguments: { repo: "acme/example", mode: "strict" },
          idempotency_key: "authority-direct",
          action_id: "authority-direct",
        }),
      });
      assert.equal(directRes.status, 403);
      assert.equal(gatewayChild.exitCode, null);
    },
  );
});
