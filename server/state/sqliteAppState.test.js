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
