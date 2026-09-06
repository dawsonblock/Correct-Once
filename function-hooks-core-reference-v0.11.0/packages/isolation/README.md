# @function-hooks/isolation

Experimental plugin isolation package. The local default uses Node's permission model and an RPC child process; a rootless Podman launch builder supplies a stronger OS/container boundary when available. Capability grants are explicit and deny by default.

The package depends on plugin loader interfaces, not the compatibility runtime. `kernelIsolationPort()` and `deferredIsolationPort()` bridge stable runtimes without changing core semantics.
