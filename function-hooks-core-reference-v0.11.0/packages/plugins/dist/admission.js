import { verifyManagedConfig } from "@function-hooks/assurance";
import { computePluginDigest } from "./digest.js";
export async function admitPinnedPlugins(descriptors, sealed, publicKeyPem) {
    verifyManagedConfig(sealed, publicKeyPem);
    const pins = new Map(sealed.config.plugins.map((pin) => [pin.name, pin.digest]));
    if (pins.size !== sealed.config.plugins.length)
        throw new Error("Managed config contains duplicate plugin pins.");
    const descriptorNames = new Set();
    const records = [];
    for (const descriptor of descriptors) {
        const name = descriptor.manifest.name;
        if (descriptorNames.has(name))
            throw new Error(`Duplicate plugin descriptor: ${name}`);
        descriptorNames.add(name);
        const expectedDigest = pins.get(name);
        const actualDigest = await computePluginDigest(descriptor);
        if (!expectedDigest) {
            records.push({ name, expectedDigest: "<unmanaged>", actualDigest, admitted: false, reason: "plugin is not pinned by managed config" });
            continue;
        }
        if (expectedDigest !== actualDigest) {
            records.push({ name, expectedDigest, actualDigest, admitted: false, reason: "digest mismatch" });
            continue;
        }
        records.push({ name, expectedDigest, actualDigest, admitted: true });
    }
    for (const pin of sealed.config.plugins) {
        if (!descriptorNames.has(pin.name))
            records.push({ name: pin.name, expectedDigest: pin.digest, actualDigest: "<missing>", admitted: false, reason: "pinned plugin is missing" });
    }
    const denied = records.filter((record) => !record.admitted);
    if (denied.length > 0)
        throw new Error(`Plugin admission failed: ${denied.map((record) => `${record.name}: ${record.reason}`).join(", ")}`);
    return Object.freeze({ configHash: sealed.sha256, records: Object.freeze(records) });
}
//# sourceMappingURL=admission.js.map