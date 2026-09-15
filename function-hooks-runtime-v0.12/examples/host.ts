import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCapabilityCandidate } from "@function-hooks/capabilities";
import { allowAllGatewayAuthorizer, createAgentGateway } from "@function-hooks/gateway";
import {
  InMemoryRuntimeCapabilityRegistry,
  admitRuntimeCapability,
  createEffectGatewayClient,
  createFunctionHooksRuntime,
  type FunctionHooksRuntime,
} from "../src/index.ts";

type HostSurface = Pick<
  FunctionHooksRuntime,
  "searchCapabilities" | "invokeCapability" | "close"
>;

type RuntimeCapabilityOptions = Omit<
  Parameters<typeof admitRuntimeCapability>[1],
  "admissionId" | "policyVersion" | "admittedAt"
> & {
  readonly admittedAt?: string;
};

function runtimeCapability(
  overrides: Partial<Parameters<typeof createCapabilityCandidate>[0]>,
  options: RuntimeCapabilityOptions,
) {
  return admitRuntimeCapability(
    createCapabilityCandidate({
      app: "demo",
      capability: "placeholder",
      description: "placeholder",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      sideEffect: "read",
      sensitivity: "public",
      risk: "low",
      provenance: {
        connectorId: "correct-once-host",
        connectorType: "example-host",
        discoveredAt: "2026-09-15T00:00:00.000Z",
        version: "1",
      },
      implementation: { kind: "filesystem.read", path: "placeholder.txt" },
      ...overrides,
    }),
    {
      admissionId: "adm-host-v0-16",
      policyVersion: "policy-host-v0-16",
      admittedAt: options.admittedAt ?? "2026-09-15T00:01:00.000Z",
      ...options,
    },
  );
}

function configuredEffectGateway() {
  const baseUrl = process.env.EFFECT_GATEWAY_URL?.trim();
  const bearerToken = process.env.EFFECT_GATEWAY_TOKEN?.trim();

  if (!baseUrl && !bearerToken) {
    return createEffectGatewayClient(async () => {
      throw new Error(
        "Set EFFECT_GATEWAY_URL and EFFECT_GATEWAY_TOKEN to invoke demo.github.repo.settings.",
      );
    });
  }
  if (!baseUrl || !bearerToken) {
    throw new Error(
      "EFFECT_GATEWAY_URL and EFFECT_GATEWAY_TOKEN must be set together.",
    );
  }
  return createEffectGatewayClient({ baseUrl, bearerToken });
}

export async function createDemoHostRuntime(): Promise<HostSurface> {
  const tempRoot = await mkdtemp(join(tmpdir(), "correct-once-host-"));
  const notePath = join(tempRoot, "note.txt");
  const statePath = join(tempRoot, "state.txt");
  await writeFile(notePath, "correct-once host demo\n", "utf8");

  const gateway = await createAgentGateway({
    receipts: false,
    authorizer: allowAllGatewayAuthorizer(),
    adapters: {
      "fs.read": async (input) => {
        const data = await readFile(input.path, "utf8");
        return {
          data,
          bytes: Buffer.byteLength(data),
        };
      },
      "fs.write": async (input) => {
        await writeFile(input.path, input.data, "utf8");
        return {
          path: input.path,
          bytesWritten: Buffer.byteLength(input.data),
        };
      },
    },
  });

  const registry = new InMemoryRuntimeCapabilityRegistry();
  await registry.register(
    runtimeCapability(
      {
        id: "demo.text.uppercase",
        capability: "text.uppercase",
        description: "Uppercase JSON text in-process",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string" },
          },
          required: ["text"],
        },
        implementation: { kind: "filesystem.read", path: "ignored-by-pure-handler.txt" },
      },
      {
        executionClass: "pure",
        pureHandlerId: "text-uppercase",
        requiresLightweightAuth: false,
      },
    ),
  );
  await registry.register(
    runtimeCapability(
      {
        id: "demo.file.read-note",
        capability: "file.read-note",
        description: "Read a fixed demo note from disk",
        inputSchema: { type: "null" },
        implementation: { kind: "filesystem.read", path: notePath },
      },
      {
        executionClass: "read",
        policyHookId: "read-subject",
      },
    ),
  );
  await registry.register(
    runtimeCapability(
      {
        id: "demo.state.write",
        capability: "state.write",
        description: "Write host demo state to a temp file",
        inputSchema: {
          type: "object",
          properties: {
            data: { type: "string" },
          },
          required: ["data"],
        },
        sideEffect: "write",
        risk: "medium",
        implementation: { kind: "filesystem.write", path: statePath },
      },
      {
        executionClass: "mutation",
        policyHookId: "write-subject",
        requiresLightweightAuth: false,
      },
    ),
  );
  await registry.register(
    runtimeCapability(
      {
        id: "demo.github.repo.settings",
        app: "github",
        capability: "repo.settings",
        description: "Route a non-destructive repo settings update through the live effect gateway",
        inputSchema: {
          type: "object",
          properties: {
            repo: { type: "string" },
            mode: { type: "string" },
          },
          required: ["repo", "mode"],
        },
        outputSchema: { type: "object" },
        sideEffect: "write",
        risk: "high",
        implementation: { kind: "mcp", server: "github", tool: "repo.settings" },
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
    effectGateway: configuredEffectGateway(),
    pureHandlers: {
      "text-uppercase": ({ request }) => {
        const text = (request.input as { text: string }).text;
        return { text: text.toUpperCase() };
      },
    },
    policyHooks: {
      "read-subject": ({ context }) => {
        if (!context.subject?.trim()) {
          throw new Error("subject is required for demo reads");
        }
      },
      "write-subject": ({ context }) => {
        if (!context.subject?.trim()) {
          throw new Error("subject is required for demo writes");
        }
      },
    },
    receipts: {
      onStart: () => {},
      onSuccess: () => {},
      onFailure: () => {},
    },
  });

  return {
    searchCapabilities: runtime.searchCapabilities,
    invokeCapability: runtime.invokeCapability,
    close: async () => {
      await runtime.close();
      await gateway.close();
    },
  };
}

async function main() {
  const host = await createDemoHostRuntime();
  try {
    const catalog = await host.searchCapabilities();
    console.log("catalog", JSON.stringify(catalog, null, 2));

    const pure = await host.invokeCapability({
      id: "demo.text.uppercase",
      actionId: "demo-pure",
      input: { text: "correct-once" },
    });
    console.log("pure", JSON.stringify(pure));

    const read = await host.invokeCapability(
      {
        id: "demo.file.read-note",
        actionId: "demo-read",
      },
      { subject: "host-demo-reader" },
    );
    console.log("read", JSON.stringify(read));

    const mutation = await host.invokeCapability(
      {
        id: "demo.state.write",
        actionId: "demo-mutation",
        idempotencyKey: "demo-mutation",
        input: { data: "updated from host smoke" },
      },
      { subject: "host-demo-writer" },
    );
    console.log("mutation", JSON.stringify(mutation));

    if (process.env.RUN_CRITICAL_DEMO === "1") {
      const critical = await host.invokeCapability(
        {
          id: "demo.github.repo.settings",
          actionId: "demo-critical",
          idempotencyKey: "demo-critical",
          input: { repo: "acme/example", mode: "strict" },
        },
        { subject: "host-demo-writer" },
      );
      console.log("critical", JSON.stringify(critical));
    } else {
      console.log(
        "critical",
        "skipped (set RUN_CRITICAL_DEMO=1 and EFFECT_GATEWAY_URL/TOKEN to exercise the live gateway)",
      );
    }
  } finally {
    await host.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
