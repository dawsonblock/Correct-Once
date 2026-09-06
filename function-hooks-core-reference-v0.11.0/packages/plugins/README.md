# @function-hooks/plugins

Experimental plugin lifecycle package: manifests, realpath validation, content digests, managed admission, ordering, trusted loader interfaces, and generation publication.

`kernelRegistrar()` and `registerPluginsIntoKernel()` are explicit migration adapters. They accept exact event hooks only. Wildcards and `engine.create` are rejected rather than silently emulated inside the stable kernel.
