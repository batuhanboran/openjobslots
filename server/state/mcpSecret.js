"use strict";

// MCP agent-login credential handling.
//
// Two independent concerns:
//   1. Redaction  - never return agent_login_password to a settings API client.
//                   getMcpSettings() keeps the true value for internal consumers
//                   (buildMcpRunbook); redaction is applied ONLY at HTTP response
//                   boundaries via redactMcpSettings().
//   2. At-rest    - optional AES-256-GCM encryption of the column, keyed by
//     encryption   OPENJOBSLOTS_MCP_SECRET_KEY (or OPENJOBSLOTS_SECRET_KEY).
//                   Ships INERT: with no key set, encrypt/decrypt are no-ops and
//                   legacy plaintext rows pass through unchanged. The key must be
//                   present in BOTH the app and the mcp-apply-server process, or
//                   agent login breaks.

const crypto = require("crypto");

const ENC_PREFIX = "enc:v1:";

function deriveKey() {
  const raw =
    process.env.OPENJOBSLOTS_MCP_SECRET_KEY ||
    process.env.OPENJOBSLOTS_SECRET_KEY ||
    "";
  if (!raw) return null;
  return crypto.createHash("sha256").update(String(raw)).digest(); // 32 bytes
}

function encryptSecret(plain, key = deriveKey()) {
  const text = String(plain ?? "");
  // No key configured or empty secret => store as-is (feature stays inert).
  if (!key || !text) return text;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

function isEncryptedSecret(value) {
  return String(value ?? "").startsWith(ENC_PREFIX);
}

function decryptSecret(stored, key = deriveKey()) {
  const value = String(stored ?? "");
  if (!isEncryptedSecret(value)) return value; // legacy plaintext / empty
  if (!key) return ""; // encrypted but no key available -> cannot recover
  try {
    const buf = Buffer.from(value.slice(ENC_PREFIX.length), "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

// Replace the plaintext secret in an API response with an empty string and a
// boolean "is set" flag. Empty on read + preserve-on-empty on write means a
// client that round-trips the settings object cannot accidentally wipe the
// stored credential.
function redactMcpSettings(settings) {
  if (!settings || typeof settings !== "object") return settings;
  const hasSecret = String(settings.agent_login_password ?? "").length > 0;
  return {
    ...settings,
    agent_login_password: "",
    agent_login_password_set: hasSecret
  };
}

module.exports = {
  ENC_PREFIX,
  deriveKey,
  encryptSecret,
  decryptSecret,
  isEncryptedSecret,
  redactMcpSettings
};
