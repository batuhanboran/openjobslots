const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("crypto");

const {
  encryptSecret,
  decryptSecret,
  redactMcpSettings,
  ENC_PREFIX
} = require("./mcpSecret");

const KEY = crypto.createHash("sha256").update("test-key").digest();

// --- at-rest encryption ----------------------------------------------------
test("encrypt/decrypt round-trips with a key", () => {
  const c = encryptSecret("hunter2", KEY);
  assert.ok(c.startsWith(ENC_PREFIX));
  assert.notEqual(c, "hunter2");
  assert.equal(decryptSecret(c, KEY), "hunter2");
});

test("no key => encrypt/decrypt are no-ops (feature ships inert)", () => {
  assert.equal(encryptSecret("hunter2", null), "hunter2");
  assert.equal(decryptSecret("hunter2", null), "hunter2");
});

test("legacy plaintext (no prefix) decrypts to itself", () => {
  assert.equal(decryptSecret("plainpw", KEY), "plainpw");
});

test("empty secret stays empty", () => {
  assert.equal(encryptSecret("", KEY), "");
  assert.equal(decryptSecret("", KEY), "");
});

test("encrypted value but missing key => cannot recover (empty)", () => {
  const c = encryptSecret("hunter2", KEY);
  assert.equal(decryptSecret(c, null), "");
});

test("wrong key => empty (GCM auth failure, no throw)", () => {
  const c = encryptSecret("hunter2", KEY);
  const wrong = crypto.createHash("sha256").update("other").digest();
  assert.equal(decryptSecret(c, wrong), "");
});

// --- response redaction ----------------------------------------------------
test("redactMcpSettings hides password, keeps a set flag, no mutation", () => {
  const src = { enabled: true, agent_login_password: "hunter2", preferred_search: "dev" };
  const red = redactMcpSettings(src);
  assert.equal(red.agent_login_password, "");
  assert.equal(red.agent_login_password_set, true);
  assert.equal(red.preferred_search, "dev");
  assert.equal(src.agent_login_password, "hunter2"); // original untouched
});

test("redactMcpSettings flags empty password as not set", () => {
  const red = redactMcpSettings({ agent_login_password: "" });
  assert.equal(red.agent_login_password, "");
  assert.equal(red.agent_login_password_set, false);
});
