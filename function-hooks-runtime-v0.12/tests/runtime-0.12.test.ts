import assert from "node:assert/strict";
import test from "node:test";
import { createCapabilityCandidate } from "@function-hooks/capabilities";
import { allowAllGatewayAuthorizer, createAgentGateway } from "@function-hooks/gateway";
import {
  InMemoryRuntimeCapabilityRegistry,
  RuntimeEffectExecutionDeniedError,
  admitRuntimeCapability,
  createFunctionHooksRuntime,
  type RuntimeAdmittedCapability,
} from "../src/index.ts";

function candidate(
  overrides: Partial<Parameters<typeof createCapabilityCandidate>[0]> = {},
) {
  return createCapabilityCandidate({
    app: "github",
    capability: "repo.read",
    description: "Read repository content",
    inputSchema: { type: "object", properties: { repo: { type: "string" } }, required: ["repo"] },
    outputSchema: { type: "object" },
    sideEffect: "read",
    sensitivity: "private",
    risk: "low",
    provenance: {
      connectorId: "github-mcp",
      connectorType: "mcp",
      discoveredAt: "2026-09-06T00:00:00.000Z",
      version: "1",
    },
    implementation: { kind: "mcp", server: "github", tool: "repo.read" },
    ...overrides,
  });
}

function runtimeCapability(
  overrides: Partial<Parameters<typeof createCapabilityCandidate>[0]>,
  options: Omit<
    Parameters<typeof admitRuntimeCapability>[1],
    "admissionId" | "policyVersion" | "admittedAt"
  > & { readonly admittedAt?: string },
): RuntimeAdmittedCapability {
  return admitRuntimeCapability(candidate(overrides), {
    admissionId: "adm-1",
    policyVersion: "policy-1",
    admittedAt: options.admittedAt ?? "2026-09-06T00:01:00.000Z",
    ...options,
  });
}

class CountingRegistry extends InMemoryRuntimeCapabilityRegistry {
  gets = 0;

  override async get(id: string) {
    this.gets += 1;
    return super.get(id);
  }
}

test("pure and read execute on the fast path without calling Effect Fabric", async (t) => {
  const directCalls: string[] = [];
  const effectCalls: string[] = [];
  const seenSubjects: string[] = [];
  const gateway = await createAgentGateway({
    receipts: false,
    authorizer: allowAllGatewayAuthorizer(),
    adapters: {
      "fs.read": async (input) => {
        directCalls.push(`fs.read:${input.path}`);
        return { data: input.path, bytes: input.path.length };
      },
      "mcp.call": async (input) => {
        directCalls.push(`mcp.call:${input.server}/${input.tool}`);
        return { server: input.server, tool: input.tool, args: input.args };
      },
    },
  });
  const registry = new InMemoryRuntimeCapabilityRegistry();
  await registry.register(
    runtimeCapability(
      {
        id: "workspace.config.read",
        app: "workspace",
        capability: "config.read",
        description: "Read workspace config",
        inputSchema: { type: "string" },
        outputSchema: { type: "object" },
        implementation: { kind: "filesystem.read" },
      },
      {
        executionClass: "pure",
        requiresLightweightAuth: false,
      },
    ),
  );
  await registry.register(
    runtimeCapability(
      {
        id: "github.repo.read",
        capability: "repo.read",
      },
      {
        executionClass: "read",
        policyHookId: "read-auth",
      },
    ),
  );

  const runtime = createFunctionHooksRuntime({
    registry,
    fastGateway: gateway,
    effectGateway: async (input) => {
      effectCalls.push(`${input.server}/${input.tool}`);
      return { from: "effect" };
    },
    policyHooks: {
      "read-auth": ({ context }) => {
        if (!context.subject) throw new Error("subject required");
        seenSubjects.push(context.subject);
      },
    },
  });

  t.after(async () => {
    await runtime.close();
    await gateway.close();
  });

  const pureResult = await runtime.invokeCapability({
    id: "workspace.config.read",
    actionId: "pure-1",
    input: "config/runtime.json",
  });
  const readResult = await runtime.invokeCapability(
    {
      id: "github.repo.read",
      actionId: "read-1",
      input: { repo: "acme/example" },
    },
    { subject: "reader-1" },
  );

  assert.deepEqual(pureResult, { data: "config/runtime.json", bytes: 19 });
  assert.deepEqual(readResult, {
    server: "github",
    tool: "repo.read",
    args: { repo: "acme/example" },
  });
  assert.deepEqual(directCalls, [
    "fs.read:config/runtime.json",
    "mcp.call:github/repo.read",
  ]);
  assert.deepEqual(effectCalls, []);
  assert.deepEqual(seenSubjects, ["reader-1"]);
});

test("read capabilities keep lightweight auth on the fast path", async (t) => {
  let directCalls = 0;
  let effectCalls = 0;
  const gateway = await createAgentGateway({
    receipts: false,
    authorizer: allowAllGatewayAuthorizer(),
    adapters: {
      "mcp.call": async () => {
        directCalls += 1;
        return { ok: true };
      },
    },
  });
  const registry = new InMemoryRuntimeCapabilityRegistry();
  await registry.register(
    runtimeCapability(
      {
        id: "github.repo.read-authz",
        capability: "repo.read",
      },
      {
        executionClass: "read",
        policyHookId: "read-auth",
      },
    ),
  );
  const runtime = createFunctionHooksRuntime({
    registry,
    fastGateway: gateway,
    effectGateway: async () => {
      effectCalls += 1;
      return { from: "effect" };
    },
    policyHooks: {
      "read-auth": ({ context }) => {
        if (!context.subject) throw new Error("subject required");
      },
    },
  });

  t.after(async () => {
    await runtime.close();
    await gateway.close();
  });

  await assert.rejects(
    runtime.invokeCapability({
      id: "github.repo.read-authz",
      actionId: "read-auth-missing",
      input: { repo: "acme/example" },
    }),
    /subject required/,
  );
  assert.equal(directCalls, 0);
  assert.equal(effectCalls, 0);
});

test("mutation and critical capabilities go through the effect tier", async (t) => {
  const directCalls: string[] = [];
  const effectCalls: string[] = [];
  const receiptPhases: string[] = [];
  const gateway = await createAgentGateway({
    receipts: false,
    authorizer: allowAllGatewayAuthorizer(),
    adapters: {
      "mcp.call": async (input) => {
        directCalls.push(`${input.server}/${input.tool}`);
        return { direct: true };
      },
    },
  });
  const registry = new InMemoryRuntimeCapabilityRegistry();
  await registry.register(
    runtimeCapability(
      {
        id: "github.repo.update",
        capability: "repo.update",
        description: "Update repository metadata",
        sideEffect: "write",
        risk: "medium",
        implementation: { kind: "mcp", server: "github", tool: "repo.update" },
      },
      {
        executionClass: "mutation",
        policyHookId: "mutation-guard",
        requiresLightweightAuth: false,
      },
    ),
  );
  await registry.register(
    runtimeCapability(
      {
        id: "github.repo.delete",
        capability: "repo.delete",
        description: "Delete repository",
        sideEffect: "destructive",
        risk: "critical",
        implementation: { kind: "mcp", server: "github", tool: "repo.delete" },
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
    effectGateway: async (input) => {
      effectCalls.push(`${input.server}/${input.tool}`);
      return { server: input.server, tool: input.tool, args: input.arguments };
    },
    policyHooks: {
      "mutation-guard": () => {
        receiptPhases.push("policy");
      },
    },
    receipts: {
      onStart: () => {
        receiptPhases.push("start");
      },
      onSuccess: () => {
        receiptPhases.push("success");
      },
    },
  });

  t.after(async () => {
    await runtime.close();
    await gateway.close();
  });

  const mutation = await runtime.invokeCapability(
    {
      id: "github.repo.update",
      actionId: "mut-1",
      input: { repo: "acme/example", description: "updated" },
    },
    { subject: "writer-1" },
  );
  const critical = await runtime.invokeCapability(
    {
      id: "github.repo.delete",
      actionId: "crit-1",
      input: { repo: "acme/example" },
    },
    { subject: "writer-1", allowDestructive: true },
  );

  assert.deepEqual(mutation, {
    server: "github",
    tool: "repo.update",
    args: { repo: "acme/example", description: "updated" },
  });
  assert.deepEqual(critical, {
    server: "github",
    tool: "repo.delete",
    args: { repo: "acme/example" },
  });
  assert.deepEqual(directCalls, []);
  assert.deepEqual(effectCalls, ["github/repo.update", "github/repo.delete"]);
  assert.deepEqual(receiptPhases, ["policy", "start", "success"]);
});

test("handle cache avoids a second registry resolve for repeated invokes", async (t) => {
  const gateway = await createAgentGateway({
    receipts: false,
    authorizer: allowAllGatewayAuthorizer(),
    adapters: {
      "fs.read": async (input) => ({ data: input.path, bytes: input.path.length }),
    },
  });
  const registry = new CountingRegistry();
  await registry.register(
    runtimeCapability(
      {
        id: "workspace.file.read",
        app: "workspace",
        capability: "file.read",
        description: "Read a workspace file",
        inputSchema: { type: "string" },
        implementation: { kind: "filesystem.read" },
      },
      {
        executionClass: "pure",
        requiresLightweightAuth: false,
      },
    ),
  );
  const runtime = createFunctionHooksRuntime({
    registry,
    fastGateway: gateway,
    effectGateway: async () => ({ from: "effect" }),
  });

  t.after(async () => {
    await runtime.close();
    await gateway.close();
  });

  await runtime.invokeCapability({
    id: "workspace.file.read",
    actionId: "cache-1",
    input: "README.md",
  });
  await runtime.invokeCapability({
    id: "workspace.file.read",
    actionId: "cache-2",
    input: "LICENSE",
  });

  assert.equal(registry.gets, 1);
  assert.equal(runtime.cacheSize, 1);
});

test("effect tier fails closed when the schema digest pin drifts", async (t) => {
  let effectCalls = 0;
  const gateway = await createAgentGateway({
    receipts: false,
    authorizer: allowAllGatewayAuthorizer(),
    adapters: {
      "mcp.call": async () => ({ ok: true }),
    },
  });
  const registry = new InMemoryRuntimeCapabilityRegistry();
  const admitted = runtimeCapability(
    {
      id: "github.repo.write-drifted",
      capability: "repo.write",
      description: "Write repository data",
      sideEffect: "write",
      implementation: { kind: "mcp", server: "github", tool: "repo.write" },
    },
    {
      executionClass: "mutation",
      requiresLightweightAuth: false,
    },
  );
  const drifted = {
    ...admitted,
    capability: {
      ...admitted.capability,
      provenance: {
        ...admitted.capability.provenance,
        schemaDigest: "0".repeat(64),
      },
    },
  } satisfies RuntimeAdmittedCapability;
  await registry.register(drifted);
  const runtime = createFunctionHooksRuntime({
    registry,
    fastGateway: gateway,
    effectGateway: async () => {
      effectCalls += 1;
      return { from: "effect" };
    },
  });

  t.after(async () => {
    await runtime.close();
    await gateway.close();
  });

  await assert.rejects(
    runtime.invokeCapability(
      {
        id: "github.repo.write-drifted",
        actionId: "digest-drift",
        input: { repo: "acme/example" },
      },
      { subject: "writer-1" },
    ),
    RuntimeEffectExecutionDeniedError,
  );
  assert.equal(effectCalls, 0);
});

test("destructive effect execution stays off by default", async (t) => {
  let effectCalls = 0;
  const gateway = await createAgentGateway({
    receipts: false,
    authorizer: allowAllGatewayAuthorizer(),
    adapters: {
      "mcp.call": async () => ({ ok: true }),
    },
  });
  const registry = new InMemoryRuntimeCapabilityRegistry();
  await registry.register(
    runtimeCapability(
      {
        id: "github.repo.purge",
        capability: "repo.purge",
        description: "Purge repository",
        sideEffect: "destructive",
        risk: "critical",
        implementation: { kind: "mcp", server: "github", tool: "repo.purge" },
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
    effectGateway: async () => {
      effectCalls += 1;
      return { from: "effect" };
    },
  });

  t.after(async () => {
    await runtime.close();
    await gateway.close();
  });

  await assert.rejects(
    runtime.invokeCapability(
      {
        id: "github.repo.purge",
        actionId: "destructive-default-off",
        input: { repo: "acme/example" },
      },
      { subject: "writer-1" },
    ),
    RuntimeEffectExecutionDeniedError,
  );
  assert.equal(effectCalls, 0);
});
