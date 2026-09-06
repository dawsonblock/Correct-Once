import assert from "node:assert/strict";
import test from "node:test";
import { createCapabilityCandidate } from "@function-hooks/capabilities";
import { allowAllGatewayAuthorizer, createAgentGateway } from "@function-hooks/gateway";
import {
  InMemoryRuntimeCapabilityRegistry,
  RuntimeEffectExecutionDeniedError,
  RuntimeExecutionPolicyError,
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

function receiptHooks(phases: string[]) {
  return {
    onStart: () => {
      phases.push("start");
    },
    onSuccess: () => {
      phases.push("success");
    },
    onFailure: () => {
      phases.push("failure");
    },
  };
}

class CountingRegistry extends InMemoryRuntimeCapabilityRegistry {
  gets = 0;

  override async get(id: string) {
    this.gets += 1;
    return super.get(id);
  }
}

test("pure stays in-process and read stays direct without calling Effect Fabric", async (t) => {
  const directCalls: string[] = [];
  const effectCalls: string[] = [];
  const readChecks: string[] = [];
  const gateway = await createAgentGateway({
    receipts: false,
    authorizer: allowAllGatewayAuthorizer(),
    adapters: {
      "mcp.call": async (input) => {
        directCalls.push(`${input.server}/${input.tool}`);
        return { server: input.server, tool: input.tool, args: input.args };
      },
    },
  });
  const registry = new InMemoryRuntimeCapabilityRegistry();
  await registry.register(
    runtimeCapability(
      {
        id: "runtime.json.normalize",
        app: "runtime",
        capability: "json.normalize",
        description: "Normalize runtime JSON",
        inputSchema: { type: "object" },
        implementation: { kind: "mcp", server: "github", tool: "should-never-run" },
      },
      {
        executionClass: "pure",
        pureHandlerId: "normalize-json",
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

  const allowedSubjects = new Set(["reader-1"]);
  const runtime = createFunctionHooksRuntime({
    registry,
    fastGateway: gateway,
    effectGateway: async (input) => {
      effectCalls.push(`${input.server}/${input.tool}`);
      return { from: "effect" };
    },
    pureHandlers: {
      "normalize-json": ({ request }) => ({
        normalized: request.input,
      }),
    },
    policyHooks: {
      "read-auth": ({ handle, context }) => {
        const subject = context.subject?.trim();
        if (!subject) throw new Error("subject required");
        if (!allowedSubjects.has(subject)) {
          throw new Error(`subject ${subject} is not allowlisted for ${handle.id}`);
        }
        readChecks.push(subject);
      },
    },
  });

  t.after(async () => {
    await runtime.close();
    await gateway.close();
  });

  const pureResult = await runtime.invokeCapability({
    id: "runtime.json.normalize",
    actionId: "pure-1",
    input: { repo: "acme/example" },
  });
  const readResult = await runtime.invokeCapability(
    {
      id: "github.repo.read",
      actionId: "read-1",
      input: { repo: "acme/example" },
    },
    { subject: "reader-1" },
  );

  assert.deepEqual(pureResult, {
    normalized: { repo: "acme/example" },
  });
  assert.deepEqual(readResult, {
    server: "github",
    tool: "repo.read",
    args: { repo: "acme/example" },
  });
  assert.deepEqual(directCalls, ["github/repo.read"]);
  assert.deepEqual(effectCalls, []);
  assert.deepEqual(readChecks, ["reader-1"]);
});

test("read re-checks subject and allowlist on every call even with a cached handle", async (t) => {
  let directCalls = 0;
  let effectCalls = 0;
  let authChecks = 0;
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
  const registry = new CountingRegistry();
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
      "read-auth": ({ handle, context }) => {
        authChecks += 1;
        const subject = context.subject?.trim();
        if (!subject) throw new Error("subject required");
        if (subject !== "reader-1") {
          throw new Error(`subject ${subject} is not allowlisted for ${handle.id}`);
        }
      },
    },
  });

  t.after(async () => {
    await runtime.close();
    await gateway.close();
  });

  await runtime.invokeCapability(
    {
      id: "github.repo.read-authz",
      actionId: "read-auth-ok",
      input: { repo: "acme/example" },
    },
    { subject: "reader-1" },
  );
  await assert.rejects(
    runtime.invokeCapability(
      {
        id: "github.repo.read-authz",
        actionId: "read-auth-denied",
        input: { repo: "acme/example" },
      },
      { subject: "reader-2" },
    ),
    /not allowlisted/,
  );

  assert.equal(registry.gets, 1);
  assert.equal(authChecks, 2);
  assert.equal(directCalls, 1);
  assert.equal(effectCalls, 0);
});

test("mutation and critical capabilities stay pinned to the effect tier", async (t) => {
  const directCalls: string[] = [];
  const effectCalls: string[] = [];
  const phases: string[] = [];
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
        phases.push("policy");
      },
    },
    receipts: receiptHooks(phases),
  });

  t.after(async () => {
    await runtime.close();
    await gateway.close();
  });

  const mutation = await runtime.invokeCapability(
    {
      id: "github.repo.update",
      actionId: "mut-1",
      idempotencyKey: "mut-1",
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
  assert.deepEqual(phases, ["policy", "start", "success"]);
});

test("guarded mutations require idempotency keys and receipts", async (t) => {
  const phases: string[] = [];
  const gateway = await createAgentGateway({
    receipts: false,
    authorizer: allowAllGatewayAuthorizer(),
    adapters: {
      "mcp.call": async () => ({ direct: true }),
    },
  });
  const registry = new InMemoryRuntimeCapabilityRegistry();
  await registry.register(
    runtimeCapability(
      {
        id: "github.repo.patch",
        capability: "repo.patch",
        description: "Patch repository settings",
        sideEffect: "write",
        implementation: { kind: "mcp", server: "github", tool: "repo.patch" },
      },
      {
        executionClass: "mutation",
        requiresLightweightAuth: false,
      },
    ),
  );

  const runtimeMissingKey = createFunctionHooksRuntime({
    registry,
    fastGateway: gateway,
    effectGateway: async () => ({ from: "effect" }),
    receipts: receiptHooks(phases),
  });
  const runtimeMissingReceipts = createFunctionHooksRuntime({
    registry,
    fastGateway: gateway,
    effectGateway: async () => ({ from: "effect" }),
  });

  t.after(async () => {
    await runtimeMissingKey.close();
    await runtimeMissingReceipts.close();
    await gateway.close();
  });

  await assert.rejects(
    runtimeMissingKey.invokeCapability(
      {
        id: "github.repo.patch",
        actionId: "patch-no-key",
        input: { repo: "acme/example" },
      },
      { subject: "writer-1" },
    ),
    /idempotencyKey/,
  );
  await assert.rejects(
    runtimeMissingReceipts.invokeCapability(
      {
        id: "github.repo.patch",
        actionId: "patch-no-receipts",
        idempotencyKey: "patch-no-receipts",
        input: { repo: "acme/example" },
      },
      { subject: "writer-1" },
    ),
    /receipt hooks/,
  );
});

test("handle cache avoids a second registry resolve for repeated invokes", async (t) => {
  const gateway = await createAgentGateway({
    receipts: false,
    authorizer: allowAllGatewayAuthorizer(),
    adapters: {
      "mcp.call": async () => {
        throw new Error("pure must stay in-process");
      },
    },
  });
  const registry = new CountingRegistry();
  await registry.register(
    runtimeCapability(
      {
        id: "runtime.math.increment",
        app: "runtime",
        capability: "math.increment",
        description: "Increment a counter",
        inputSchema: { type: "object" },
        implementation: { kind: "mcp", server: "github", tool: "should-never-run" },
      },
      {
        executionClass: "pure",
        pureHandlerId: "increment",
        requiresLightweightAuth: false,
      },
    ),
  );
  const runtime = createFunctionHooksRuntime({
    registry,
    fastGateway: gateway,
    effectGateway: async () => ({ from: "effect" }),
    pureHandlers: {
      increment: ({ request }) => {
        const value = (request.input as { value: number }).value;
        return { value: value + 1 };
      },
    },
  });

  t.after(async () => {
    await runtime.close();
    await gateway.close();
  });

  await runtime.invokeCapability({
    id: "runtime.math.increment",
    actionId: "cache-1",
    input: { value: 1 },
  });
  await runtime.invokeCapability({
    id: "runtime.math.increment",
    actionId: "cache-2",
    input: { value: 2 },
  });

  assert.equal(registry.gets, 1);
  assert.equal(runtime.cacheSize, 1);
});

test("effect tier fails closed when the schema digest pin drifts", async (t) => {
  let effectCalls = 0;
  const phases: string[] = [];
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
    receipts: receiptHooks(phases),
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
        idempotencyKey: "digest-drift",
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

test("call-time executionClass choice is denied", async (t) => {
  let directCalls = 0;
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
        id: "github.repo.read-class-pinned",
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
    effectGateway: async () => ({ from: "effect" }),
    policyHooks: {
      "read-auth": () => {},
    },
  });

  t.after(async () => {
    await runtime.close();
    await gateway.close();
  });

  await assert.rejects(
    runtime.invokeCapability({
      id: "github.repo.read-class-pinned",
      actionId: "override-class",
      input: { repo: "acme/example" },
      executionClass: "critical",
    } as unknown as Parameters<typeof runtime.invokeCapability>[0]),
    /admit time/,
  );
  assert.equal(directCalls, 0);
});

test("pure capabilities fail closed instead of reaching MCP or other external paths", async (t) => {
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
        id: "runtime.math.double",
        app: "runtime",
        capability: "math.double",
        description: "Double a value",
        inputSchema: { type: "object" },
        implementation: { kind: "mcp", server: "github", tool: "should-never-run" },
      },
      {
        executionClass: "pure",
        pureHandlerId: "double",
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
    runtime.invokeCapability({
      id: "runtime.math.double",
      actionId: "pure-no-handler",
      input: { value: 2 },
    }),
    /pure handler/,
  );
  assert.equal(directCalls, 0);
  assert.equal(effectCalls, 0);
});

test("class downgrade without re-admit is denied", async () => {
  const registry = new InMemoryRuntimeCapabilityRegistry();
  const admitted = runtimeCapability(
    {
      id: "github.repo.destroy",
      capability: "repo.destroy",
      description: "Destroy repository",
      sideEffect: "destructive",
      risk: "critical",
      implementation: { kind: "mcp", server: "github", tool: "repo.destroy" },
    },
    {
      executionClass: "critical",
      requiresLightweightAuth: false,
    },
  );
  const downgraded = {
    ...admitted,
    execution: {
      ...admitted.execution,
      executionClass: "read" as const,
      executor: "fast" as const,
      policyHookId: "read-auth",
      requiresLightweightAuth: true,
      trustedRead: false,
    },
  } satisfies RuntimeAdmittedCapability;

  await assert.rejects(
    registry.register(downgraded),
    RuntimeExecutionPolicyError,
  );
});

test("effect failure never falls back to fast execution", async (t) => {
  let directCalls = 0;
  const phases: string[] = [];
  const gateway = await createAgentGateway({
    receipts: false,
    authorizer: allowAllGatewayAuthorizer(),
    adapters: {
      "mcp.call": async () => {
        directCalls += 1;
        return { direct: true };
      },
    },
  });
  const registry = new InMemoryRuntimeCapabilityRegistry();
  await registry.register(
    runtimeCapability(
      {
        id: "github.repo.archive",
        capability: "repo.archive",
        description: "Archive repository",
        sideEffect: "write",
        implementation: { kind: "mcp", server: "github", tool: "repo.archive" },
      },
      {
        executionClass: "mutation",
        requiresLightweightAuth: false,
      },
    ),
  );
  const runtime = createFunctionHooksRuntime({
    registry,
    fastGateway: gateway,
    effectGateway: async () => {
      throw new Error("fabric unavailable");
    },
    receipts: receiptHooks(phases),
  });

  t.after(async () => {
    await runtime.close();
    await gateway.close();
  });

  await assert.rejects(
    runtime.invokeCapability(
      {
        id: "github.repo.archive",
        actionId: "effect-fail",
        idempotencyKey: "effect-fail",
        input: { repo: "acme/example" },
      },
      { subject: "writer-1" },
    ),
    /fabric unavailable/,
  );
  assert.equal(directCalls, 0);
  assert.deepEqual(phases, ["start", "failure"]);
});
