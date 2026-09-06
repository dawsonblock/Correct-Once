# Migration to v0.9.3

v0.9.3 does not change the frozen `1.0-rc.1` kernel semantics. It is a correctness and integrity patch over the v0.9.2 routing/gateway release: trace observers are isolated, receipt replay is immutable and recovery-validated, policy rewrites are frozen before approval, security configuration is snapshotted, and process termination escalates when SIGTERM is ignored.


## v0.9.2 application routing

Install `@function-hooks/router` when one assistant must reach many applications. Define application capabilities as routes and map them onto the existing gateway channels instead of creating another gateway/kernel integration per app. Existing direct `gateway.dispatch(...)` calls remain valid. `desktop.call` is new and requires an explicit host adapter plus policy allowlist.

Existing kernel consumers require no semantic migration. Applications that previously called host tools directly can move those calls behind `createAgentGateway()` and supply explicit adapters and an authorizer.

```ts
const adapters = await createNodeGatewayAdapters({
  fsRoot,
  processProfiles: [{
    id: "approved-node-task",
    executable: process.execPath,
    fixedArgs: ["./approved-task.mjs"],
    environment: {},
  }],
});

const gateway = await createAgentGateway({
  adapters,
  authorizer: createGatewayAllowlistAuthorizer({
    events: ["fs.read", "fs.write", "process.exec"],
    processProfiles: ["approved-node-task"],
  }),
});

await gateway.dispatch("fs.read", {
  actionId: "read-1",
  path: "notes.txt",
});
```

Important changes in posture:

1. no authorizer means deny-all;
2. gateway `origin` is diagnostic, not authenticated identity;
3. action rewrites are revalidated;
4. side-effect events use action receipts by default, but the default store is process-local rather than crash-durable;
5. Node host adapters add independent file/process/network restrictions;
6. cancellation is cooperative and never implies rollback.


### v0.9.1 process migration

Raw `process.exec.command` remains source-compatible but is denied by the Node host adapter unless `allowLegacyProcessCommands: true` is set explicitly. New code should dispatch `{ actionId, profile, args? }`. A profile with no `validateArgs` accepts no caller-supplied arguments. Child processes receive only the profile's explicit `environment`; the gateway host environment is never inherited.

Policy rewrites may alter an operation but may not replace `actionId`; attempts fail with `GatewayInvalidRewriteError`. `FileActionReceiptStore` and `DurableAuditJournal` are serialized per opened instance. They are crash-reopen capable for a single process, not a distributed/multi-process consensus store.
