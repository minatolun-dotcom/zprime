// R-28: credential encryption at rest for the opt-in IRP/EWB connectivity.
//
// AES-256-GCM (authenticated) for OUR storage. Key comes from the IRP_ENC_KEY
// env var (base64, 32 bytes) — the R-09 fail-fast posture: the boot path
// refuses to start when encrypted rows exist and the key is missing/invalid.
// Plaintext secrets never appear in logs or API responses (masking is done by
// the routes layer; this module only does byte-level crypto).
//
// Storage format: base64(nonce[12] || authTag[16] || ciphertext). The nonce is
// random per encryption; GCM's auth tag makes tampered ciphertexts fail the
// decrypt loudly (never silently yield garbage).

import crypto from "node:crypto";

let cachedKey: Buffer | null = null;

/** Boot-time validation. Called from index.ts AFTER migrations (when we can
 *  tell whether encrypted rows exist) and lazily by encrypt/decrypt. Throws
 *  with an operator-actionable message. */
export function irpKeyFromEnv(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.IRP_ENC_KEY;
  if (!raw || raw.trim() === "") {
    throw new Error(
      "IRP_ENC_KEY is not set. It is required once any company stores IRP " +
        "credentials (and to configure them). Generate one with: " +
        `openssl rand -base64 32\n${process.env.JWT_SECRET ? "" : "(Set it in .env — cp .env.example .env)"}`,
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `IRP_ENC_KEY must decode to exactly 32 bytes (got ${key.length}). Generate one with: openssl rand -base64 32`,
    );
  }
  cachedKey = key;
  return key;
}

/** Test/diagnostic escape hatch — clears the cached key so env changes are
 *  picked up. Not used on request paths. */
export function _resetIrpKeyCache(): void {
  cachedKey = null;
}

export function encryptSecret(plaintext: string): string {
  const key = irpKeyFromEnv();
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, tag, ct]).toString("base64");
}

export function decryptSecret(blob: string): string {
  const key = irpKeyFromEnv();
  const raw = Buffer.from(blob, "base64");
  if (raw.length < 12 + 16) throw new Error("Encrypted blob too short — wrong IRP_ENC_KEY or corrupt row?");
  const nonce = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/** Whether any encrypted value can be read with the current env — used by the
 *  boot check and by a diagnostic route. */
export function canDecrypt(blob: string): boolean {
  try {
    decryptSecret(blob);
    return true;
  } catch {
    return false;
  }
}
