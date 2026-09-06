import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createCapabilityCandidate } from "@function-hooks/capabilities";
import { allowAllGatewayAuthorizer, createAgentGateway } from "@function-hooks/gateway";
import {
  InMemoryRuntimeCapabilityRegistry,
  admitRuntimeCapability,
  createEffectGatewayClient,
  createFunctionHooksRuntime,
  type RuntimeCapabilityRegistry,
} from "../src/index.ts";

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
      capability: "repo.read",
      description: "Read repository content",
      inputSchema: readSchema(),
      outputSchema: { type: "object" },
      sideEffect: "read",
      sensitivity: "public",
      risk: "low",
      provenance: {
        connectorId: "github-mcp",
        connectorType: "mcp",
        discoveredAt: "2026-09-06T00:00:00.000Z",
        version: "1",
      },
      implementation: mcpImplementation("repo.read"),
      ...overrides,
    }),
    {
      admissionId: "adm-v0-15",
      policyVersion: "policy-v0-15",
      admittedAt: options.admittedAt ?? "2026-09-06T00:01:00.000Z",
      ...options,
    },
  );
}

async function loadWriteIdentityVectors(): Promise<readonly WriteIdentityVector[]> {
  const path = fileURLToPath(
    new URL("../../qualification/write-identity-vectors.json", import.meta.url),
  );
  const text = await readFile(path, "utf8");
  const document = JSON.parse(text) as {
    readonly cases: readonly WriteIdentityVector[];
  };
  return document.cases;
}

test("FAST_READ_REVOKE_WITHOUT_SUBSCRIBE denies a second external read", async (t) => {
  let readCalls = 0;
  const gateway = await createAgentGateway({
    receipts: false,
    authorizer: allowAllGatewayAuthorizer(),
    adapters: {
      "fs.read": async (input) => {
        readCalls += 1;
        return {
          data: `content:${input.path}`,
          bytes: Buffer.byteLength(`content:${input.path}`),
        };
      },
    },
  });

  const backingRegistry = new InMemoryRuntimeCapabilityRegistry();
  const capabilityId = "runtime.file.read-no-subscribe";
  await backingRegistry.register(
    runtimeCapability(
      {
        id: capabilityId,
        app: "runtime",
        capability: "file.read",
        description: "Read a fixed runtime file",
        inputSchema: { type: "null" },
        implementation: { kind: "filesystem.read", path: "fixture.txt" },
      },
      {
        executionClass: "read",
        requiresLightweightAuth: false,
      },
    ),
  );

  const registryWithoutSubscribe: RuntimeCapabilityRegistry = {
    register: (capability) => backingRegistry.register(capability),
    get: (id) => backingRegistry.get(id),
    list: (filter) => backingRegistry.list(filter),
    activate: (id, reason) => backingRegistry.activate(id, reason),
    suspend: (id, reason) => backingRegistry.suspend(id, reason),
    revoke: (id, reason) => backingRegistry.revoke(id, reason),
    supersede: (id, reason) => backingRegistry.supersede(id, reason),
    snapshot: () => backingRegistry.snapshot(),
  };

  const runtime = createFunctionHooksRuntime({
    registry: registryWithoutSubscribe,
    fastGateway: gateway,
    effectGateway: createEffectGatewayClient(async () => ({ from: "effect" })),
  });

  t.after(async () => {
    await runtime.close();
    await gateway.close();
  });

  const first = await runtime.invokeCapability({
    id: capabilityId,
    actionId: "read-first",
  });
  assert.deepEqual(first, { data: "content:fixture.txt", bytes: 19 });

  await backingRegistry.revoke(capabilityId, "revoked after first read");

  await assert.rejects(
    runtime.invokeCapability({
      id: capabilityId,
      actionId: "read-second",
    }),
    /revoked|stateVersion|cannot execute externally/,
  );
  assert.equal(readCalls, 1);
});

test("shared write identity vectors stay stable across runtime invocations", async (t) => {
  const vectors = await loadWriteIdentityVectors();
  const gateway = await createAgentGateway({
    receipts: false,
    authorizer: allowAllGatewayAuthorizer(),
    adapters: {
      "mcp.call": async () => {
        throw new Error("critical write vectors must not use the fast path");
      },
    },
  });

  const registry = new InMemoryRuntimeCapabilityRegistry();
  await registry.register(
    runtimeCapability(
      {
        id: "github.repo.settings",
        capability: "repo.settings",
        description: "Critical repository settings mutation",
        inputSchema: writeSchema(),
        outputSchema: { type: "object" },
        sideEffect: "write",
        sensitivity: "public",
        risk: "medium",
        implementation: mcpImplementation("repo.settings"),
      },
      {
        executionClass: "critical",
        requiresLightweightAuth: false,
      },
    ),
  );

  const runtime = createFunctionHooksRuntime({
    registry,
    fastGateway: gateway,
    effectGateway: createEffectGatewayClient(async (input) => ({
      traceId: input.trace_id,
      actionId: input.action_id,
      idempotencyKey: input.idempotency_key,
    })),
  });

  t.after(async () => {
    await runtime.close();
    await gateway.close();
  });

  for (const vector of vectors) {
    const result = (await runtime.invokeCapability(
      {
        id: vector.capabilityId,
        callerCorrelationId: vector.callerCorrelationId,
        idempotencyKey: vector.idempotencyKey,
        input: {
          ...vector.input,
        },
        metadata: vector.metadata,
        semanticMetadata: vector.semanticMetadata,
      } as unknown as Parameters<typeof runtime.invokeCapability>[0],
      { subject: vector.subject },
    )) as {
      readonly traceId?: string;
      readonly actionId?: string;
      readonly idempotencyKey?: string;
    };

    assert.deepEqual(result, {
      traceId: vector.expectedTraceId,
      actionId: vector.expectedTrustedActionId,
      idempotencyKey: vector.expectedTrustedIdempotencyKey,
    });
  }
});
