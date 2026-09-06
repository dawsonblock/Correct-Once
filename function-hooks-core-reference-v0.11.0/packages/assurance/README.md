# @function-hooks/assurance

Experimental assurance layer above `@function-hooks/core`. It owns schemas, size/deadline budget configuration, canonical serialization, signed managed configuration, action receipts, and schema-version negotiation. It does not change the core hook algebra.

The legacy `registerActionReceiptPlugin()` accepts a structural registrar port for the 0.5 compatibility umbrella. New kernel consumers should use `registerActionReceiptHooks()` with explicit event names.
