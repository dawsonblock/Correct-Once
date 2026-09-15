# MCP importer scaffold

This is a **fail-closed scaffold**, not an auto-admit pipeline.

Current modules:

- `discovery.py` — async MCP `tools/list` discovery hook
- `normalize.py` — normalize raw MCP tool descriptors
- `classifier.py` — execution-class classifier
- `risk_rules.py` — destructive / mutation / high-risk heuristics
- `schema_normalizer.py` — schema object normalization
- `descriptor_digest.py` — stable descriptor digest for review/admission logs
- `admission.py` — admitted-vs-denied decision envelope
- `importer.py` — bulk import report builder

## Policy lock

- destructive evidence -> `critical`
- mutating high-risk evidence -> `critical`
- mutating evidence -> `mutation`
- verified read-only evidence -> `read`
- everything else -> **denied / unclassified**

MCP annotations such as `readOnlyHint` and `destructiveHint` are treated as
**evidence**, not trust. A bare `readOnlyHint` is not enough to auto-admit a
tool as `read`.

This scaffold does **not** yet emit runtime snapshots or package a full reviewer
workflow. Unknown tools remain denied until a human-reviewed admission path is
added.
