# Roadmap After v0.2.12

## Completed through v0.2.12

- source-bound qualification and stale-evidence rejection;
- canonical transition algebra and store validation;
- worker/attempt fencing and outbox claim fencing;
- PostgreSQL crash/fencing qualification harness;
- SDK-neutral Effect Gateway;
- dynamic MCP effect factories and fail-closed schema routing;
- local cryptographic workload identity with execution evidence binding;
- environment/release-bound signed ledger anchors and external-anchor transport primitives.

## Next priority: prove the production dependencies

1. Run the packaged PostgreSQL SIGKILL/concurrency matrix against a controlled live PostgreSQL DSN.
2. Put workload-authority keys behind a real KMS/HSM or workload-attestation system and qualify rotation/revocation.
3. Deploy `HttpAnchorStore` against independently administered WORM/Object-Lock storage and prove deletion/overwrite resistance.
4. Run Ruff and mypy as mandatory gates and repair all findings.
5. Qualify one real MCP transport/provider end-to-end with fault injection.
6. Only then broaden to browser, Home Assistant, or higher-risk effect families.

The gateway must remain the single consequential-mutation boundary.
