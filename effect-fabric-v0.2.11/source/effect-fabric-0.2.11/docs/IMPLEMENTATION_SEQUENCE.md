# Implementation Sequence After v0.2.5

1. Replace the donor pure reducer inside the active DAO compatibility path with Effect Fabric's own
   reducer/runtime decisions.
2. Preserve the official 17/17 conformance result and negative-control discrimination.
3. Map withdrawal/supersession and settlement semantics onto native Effect Fabric transaction APIs.
4. Run the direct adapter over PostgreSQL with independent workers and connections.
5. Add OS-process kill points around lease/start/provider-return/settlement/evidence boundaries.
6. Qualify live provider reconciliation and independent verification.
7. Only after those gates consider promoting the v0.2 kernel or expanding provider/tool coverage.
