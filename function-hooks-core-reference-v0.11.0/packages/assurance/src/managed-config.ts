import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { canonicalJson, canonicalSha256 } from "./canonical.js";
import type { RuntimeBudgetConfig } from "./budgets.js";

export interface ManagedPluginPin {
  readonly name: string;
  readonly digest: string;
}

export interface ManagedRuntimeConfig {
  readonly format: "function-hooks-managed-config/v1";
  readonly generatedAt?: string;
  readonly prepend?: readonly string[];
  readonly append?: readonly string[];
  readonly plugins: readonly ManagedPluginPin[];
  readonly allowedEvents?: readonly string[];
  readonly budgets?: RuntimeBudgetConfig;
}

export interface SealedManagedConfig {
  readonly config: ManagedRuntimeConfig;
  readonly sha256: string;
  readonly signature?: string;
  readonly algorithm?: "Ed25519";
}

export function sealManagedConfig(config: ManagedRuntimeConfig, privateKeyPem?: string): SealedManagedConfig {
  const sha256 = canonicalSha256(config);
  if (!privateKeyPem) return Object.freeze({ config, sha256 });
  const signature = sign(null, Buffer.from(canonicalJson(config)), createPrivateKey(privateKeyPem)).toString("base64");
  return Object.freeze({ config, sha256, signature, algorithm: "Ed25519" });
}

export function verifyManagedConfig(sealed: SealedManagedConfig, publicKeyPem?: string): void {
  const actual = canonicalSha256(sealed.config);
  if (actual !== sealed.sha256) throw new Error(`Managed config hash mismatch: expected ${sealed.sha256}, got ${actual}.`);
  if (sealed.signature !== undefined) {
    if (!publicKeyPem) throw new Error("Managed config is signed but no public key was provided.");
    if (sealed.algorithm !== "Ed25519") throw new Error(`Unsupported managed config signature algorithm: ${String(sealed.algorithm)}`);
    const ok = verify(null, Buffer.from(canonicalJson(sealed.config)), createPublicKey(publicKeyPem), Buffer.from(sealed.signature, "base64"));
    if (!ok) throw new Error("Managed config signature verification failed.");
  }
}
