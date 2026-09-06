# Dependency Matrix — v0.2.5

Effect Fabric targets Python 3.11–3.13.

Runtime dependencies remain intentionally small:

- Pydantic 2.x
- cryptography 42–48

Optional:

- FastAPI/Uvicorn for the reference API
- psycopg 3.x for PostgreSQL

The five analyzed donor projects are **not runtime dependencies**. Compatibility is implemented using
Effect Fabric-owned schemas/adapters, so installing the wheel does not install Node, pnpm, OpenOnce,
AgentAction, PALO or ChronoMCP.
