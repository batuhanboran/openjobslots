const assert = require("assert");
const test = require("node:test");

const { createSqliteAppStateRuntime } = require("./sqliteAppState");

function makeRuntime() {
  return createSqliteAppStateRuntime({
    getDb: () => ({
      all: async () => [],
      exec: async () => {},
      get: async () => null,
      run: async () => ({ changes: 0 })
    }),
    dbPath: "jobs.db",
    maxAtsRequestQueueConcurrency: 20,
    mcpSettingsDefaults: { enabled: false },
    minAtsRequestQueueConcurrency: 1,
    personalInformationFields: ["first_name", "age", "years_of_experience"],
    syncServiceSettingsDefaults: {
      ats_request_queue_concurrency: 1,
      sync_enabled_ats: []
    },
    normalizeBoolean(value, fallback = false) {
      if (typeof value === "boolean") return value;
      const normalized = String(value ?? "").trim().toLowerCase();
      if (!normalized) return Boolean(fallback);
      return normalized === "1" || normalized === "true" || normalized === "yes";
    },
    normalizeMcpSettingsInput: (value) => value || {},
    normalizePersonalInformationInput(value = {}) {
      return {
        first_name: String(value.first_name || "").trim(),
        age: Number(value.age || 0),
        years_of_experience: Number(value.years_of_experience || 0)
      };
    }
  });
}

test("sqlite app state runtime can be required without the server index module", () => {
  const runtime = makeRuntime();

  assert.equal(typeof runtime.listPostingsWithFilters, "function");
  assert.equal(typeof runtime.getPersonalInformation, "function");
  assert.deepEqual(runtime.normalizeMigrationSelection({ applications: false }), {
    personal_information: true,
    mcp_settings: true,
    blocked_companies: true,
    applications: false
  });
});

// --- plaintext-pw: upsertMcpSettings write choke-point ---------------------
function fakeDb(existingPassword) {
  const runs = [];
  return {
    runs,
    all: async () => [],
    exec: async () => {},
    get: async (sql) => {
      if (/FROM McpSettings/i.test(String(sql))) {
        return { agent_login_password: existingPassword };
      }
      return null;
    },
    run: async (sql, binds) => {
      if (/INSERT INTO McpSettings/i.test(String(sql))) runs.push(binds);
      return { changes: 1 };
    }
  };
}

function runtimeWithDb(db) {
  return createSqliteAppStateRuntime({
    getDb: () => db,
    dbPath: "jobs.db",
    maxAtsRequestQueueConcurrency: 20,
    mcpSettingsDefaults: { enabled: false, agent_login_password: "" },
    minAtsRequestQueueConcurrency: 1,
    personalInformationFields: ["first_name"],
    syncServiceSettingsDefaults: { ats_request_queue_concurrency: 1, sync_enabled_ats: [] },
    normalizeBoolean: (v, f = false) =>
      typeof v === "boolean" ? v : ["1", "true", "yes"].includes(String(v ?? "").trim().toLowerCase()) || Boolean(f && !String(v ?? "")),
    normalizeMcpSettingsInput: (value) => value || {},
    normalizePersonalInformationInput: (value = {}) => ({ first_name: String(value.first_name || "").trim() }),
    parseJsonArray: (value) => (Array.isArray(value) ? value : [])
  });
}

// Index of agent_login_password in the INSERT bind array (see upsertMcpSettings).
const PW_BIND_INDEX = 4;

test("upsert preserves existing secret when incoming password is empty", async () => {
  const db = fakeDb("enc:v1:STOREDCIPHERTEXT");
  const runtime = runtimeWithDb(db);
  await runtime.upsertMcpSettings({ enabled: true, agent_login_password: "" });
  assert.equal(db.runs[0][PW_BIND_INDEX], "enc:v1:STOREDCIPHERTEXT");
});

test("upsert clears secret only with the explicit clear flag", async () => {
  const db = fakeDb("enc:v1:STOREDCIPHERTEXT");
  const runtime = runtimeWithDb(db);
  await runtime.upsertMcpSettings({ agent_login_password: "", clear_agent_login_password: true });
  assert.equal(db.runs[0][PW_BIND_INDEX], "");
});

test("upsert stores a newly provided secret (inert without a key)", async () => {
  delete process.env.OPENJOBSLOTS_MCP_SECRET_KEY;
  delete process.env.OPENJOBSLOTS_SECRET_KEY;
  const db = fakeDb("");
  const runtime = runtimeWithDb(db);
  await runtime.upsertMcpSettings({ agent_login_password: "newpass" });
  assert.equal(db.runs[0][PW_BIND_INDEX], "newpass"); // no key => stored as-is
});

test("upsert encrypts a newly provided secret when a key is configured", async () => {
  process.env.OPENJOBSLOTS_MCP_SECRET_KEY = "unit-test-key";
  try {
    const db = fakeDb("");
    const runtime = runtimeWithDb(db);
    await runtime.upsertMcpSettings({ agent_login_password: "newpass" });
    const stored = db.runs[0][PW_BIND_INDEX];
    assert.ok(stored.startsWith("enc:v1:"), `expected ciphertext, got ${stored}`);
    assert.notEqual(stored, "newpass");
  } finally {
    delete process.env.OPENJOBSLOTS_MCP_SECRET_KEY;
  }
});

test("upsert does NOT double-encrypt an already-encrypted incoming secret (migration replay)", async () => {
  process.env.OPENJOBSLOTS_MCP_SECRET_KEY = "unit-test-key";
  try {
    const db = fakeDb("");
    const runtime = runtimeWithDb(db);
    const already = "enc:v1:ALREADYENCRYPTED==";
    await runtime.upsertMcpSettings({ agent_login_password: already });
    assert.equal(db.runs[0][PW_BIND_INDEX], already); // stored verbatim, not re-wrapped
  } finally {
    delete process.env.OPENJOBSLOTS_MCP_SECRET_KEY;
  }
});
