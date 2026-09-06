# Provider Qualification

## Local deterministic gate

Run:

```bash
PYTHONPATH=src python scripts/qualify_provider.py --output PROVIDER_QUALIFICATION.json
```

All scenarios must report `passed=true` and `ledger_valid=true`. This gate exercises a real local
HTTP transport, including deliberate connection termination after mutation.

## Live GitHub gate

The live script intentionally mutates one disposable issue. It requires all of these variables:

- `EFFECT_FABRIC_GITHUB_TOKEN`
- `EFFECT_FABRIC_GITHUB_REPO`
- `EFFECT_FABRIC_GITHUB_ISSUE`
- `EFFECT_FABRIC_GITHUB_LABEL`
- `EFFECT_FABRIC_LIVE_GITHUB_ACK=I_UNDERSTAND_THIS_MUTATES_A_DISPOSABLE_GITHUB_ISSUE`

The chosen label must already exist and must not already be attached to the disposable issue. The
script adds the label, independently verifies it, then removes the label and independently verifies
cleanup.

A successful live happy-path run is still not connection-loss qualification. Provider ambiguity
qualification requires an external fault injector/proxy capable of dropping the client connection
at controlled points while allowing the GitHub request to continue.

Live qualification evidence should record repository identity, issue number, adapter version,
GitHub request IDs where available, timestamps, and sanitized ledger/event roots. Never store the
GitHub token in evidence.
