import { InMemoryCapabilityRegistry, admitCapability, createCapabilityCandidate, projectAgentCapabilityCatalog } from "@function-hooks/capabilities";
import { allowAllGatewayAuthorizer, createAgentGateway } from "@function-hooks/gateway";
import { createExecutionRouterFromRegistry } from "@function-hooks/router";
const discovered = createCapabilityCandidate({
    app: "github",
    capability: "repo.read",
    description: "Read repository content",
    inputSchema: { type: "object", properties: { repo: { type: "string" } }, required: ["repo"] },
    outputSchema: { type: "object" },
    sideEffect: "read",
    sensitivity: "private",
    risk: "low",
    provenance: { connectorId: "github-demo", connectorType: "mcp", version: "1" },
    implementation: { kind: "mcp", server: "github", tool: "get_file_contents" },
});
// Discovery alone grants nothing. Admission is a separate trusted step.
const admitted = admitCapability(discovered, { admissionId: "demo-admission", policyVersion: "demo-policy-v1" });
const registry = new InMemoryCapabilityRegistry();
await registry.register(admitted);
const gateway = await createAgentGateway({
    receipts: false,
    authorizer: allowAllGatewayAuthorizer(),
    adapters: { "mcp.call": async (input) => ({ server: input.server, tool: input.tool, args: input.args }) },
});
const router = await createExecutionRouterFromRegistry({ gateway, registry });
const catalog = await projectAgentCapabilityCatalog(registry);
const result = await router.execute({ actionId: "demo-capability", app: "github", capability: "repo.read", input: { repo: "example/project" } });
console.log(JSON.stringify({ discovered: discovered.lifecycle, admitted: admitted.lifecycle, catalog, result }));
await gateway.close();
//# sourceMappingURL=capability-registry-demo.js.map