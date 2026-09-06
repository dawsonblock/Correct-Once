import { createAgentGateway, createGatewayAllowlistAuthorizer } from "@function-hooks/gateway";
import { createExecutionRouter, desktopCapabilityRoute, mcpCapabilityRoute, processCapabilityRoute } from "@function-hooks/router";
const gateway = await createAgentGateway({
    receipts: false,
    authorizer: createGatewayAllowlistAuthorizer({
        events: ["mcp.call", "desktop.call", "process.exec"],
        mcpTools: { apps: ["github.repo.read"] },
        desktopOperations: { vscode: ["open-file"] },
        processProfiles: ["project-tests"],
    }),
    adapters: {
        "mcp.call": async (input) => ({ channel: "mcp", tool: input.tool, args: input.args }),
        "desktop.call": async (input) => ({ channel: "desktop", application: input.application, operation: input.operation }),
        "process.exec": async (input) => ({ exitCode: 0, stdout: `profile:${input.profile}`, stderr: "" }),
    },
});
const router = createExecutionRouter({ gateway, routes: [
        mcpCapabilityRoute({ app: "github", capability: "repo.read", server: "apps", tool: "github.repo.read" }),
        desktopCapabilityRoute({ app: "vscode", capability: "file.open", application: "vscode", operation: "open-file", mapArgs: (input) => input }),
        processCapabilityRoute({ app: "project", capability: "tests.run", profile: "project-tests" }),
    ] });
const github = await router.execute({ actionId: "demo-github", app: "github", capability: "repo.read", input: { repo: "example/project" } }, { origin: "demo-agent" });
const vscode = await router.execute({ actionId: "demo-vscode", app: "vscode", capability: "file.open", input: { path: "src/index.ts" } }, { origin: "demo-agent" });
const tests = await router.execute({ actionId: "demo-tests", app: "project", capability: "tests.run" }, { origin: "demo-agent" });
console.log(JSON.stringify({ routeCount: router.listRoutes().length, github, vscode, tests }));
await gateway.close();
//# sourceMappingURL=execution-router-demo.js.map