import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HashChainAuditLedger } from "@function-hooks/audit";
import { createAgentGateway, createGatewayAllowlistAuthorizer, createNodeGatewayAdapters, gatewayHashChainAuditSink } from "@function-hooks/gateway";
const root = await mkdtemp(join(tmpdir(), "function-hooks-agent-gateway-"));
const adapters = await createNodeGatewayAdapters({
    fsRoot: root,
    processProfiles: [{
            id: "approved-process",
            executable: process.execPath,
            fixedArgs: ["-e", "process.stdout.write('approved-process')"],
            environment: {},
            maxTimeoutMs: 2_000,
        }],
});
const ledger = new HashChainAuditLedger();
const gateway = await createAgentGateway({
    adapters,
    authorizer: createGatewayAllowlistAuthorizer({
        events: ["fs.read", "fs.write", "process.exec"],
        processProfiles: ["approved-process"],
        requireApprovalFor: ["process.exec"],
    }),
    approval: ({ event }) => event === "process.exec",
    audit: gatewayHashChainAuditSink(ledger),
});
await gateway.dispatch("fs.write", { actionId: "demo-write", path: "agent.txt", data: "Function Hooks gateway\n" }, { origin: "demo-agent" });
const read = await gateway.dispatch("fs.read", { actionId: "demo-read", path: "agent.txt" }, { origin: "demo-agent" });
const processResult = await gateway.dispatch("process.exec", { actionId: "demo-proc", profile: "approved-process" }, { origin: "demo-agent" });
console.log(JSON.stringify({ read: read.data.trim(), process: processResult.stdout, auditEntries: ledger.entries().length, auditValid: ledger.verify().ok }));
await gateway.close();
//# sourceMappingURL=agent-gateway-demo.js.map