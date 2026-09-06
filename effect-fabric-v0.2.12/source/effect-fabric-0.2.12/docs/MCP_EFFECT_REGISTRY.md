# MCP Effect Registry v1

MCP discovery is not authorization.  `tools/list` can describe a tool, but a consequential tool is
usable only after a qualified Effect Definition is registered.

Routing rules:

- registered read-only tool with unchanged schema -> fast path;
- registered mutation with unchanged schema -> governed Effect Fabric path;
- registered tool whose input schema digest changes -> deny as schema drift;
- unknown tool explicitly declared read-only -> optional read fast path;
- unknown/undetermined mutation -> deny.

ChronoMCP's `dev.chronomcp/compensate` metadata is accepted for reversibility declarations.  Missing
metadata is **UNKNOWN**, never inferred as reversible.

Compensation metadata only describes a candidate inverse.  Effect Fabric executes compensation as a
new ActionIntent with fresh authorization and verification; it never treats compensation as atomic
rollback.
