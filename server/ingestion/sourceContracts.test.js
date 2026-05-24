const assert = require("node:assert/strict");
const test = require("node:test");

const {
  SOURCE_FAMILIES,
  SOURCE_STATUSES,
  createUnsupportedSourceModule,
  validateSourceContract
} = require("./sourceContracts");

test("source contract accepts a complete module", () => {
  const sourceModule = {
    atsKey: "greenhouse",
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled,
    discover: () => ({ ok: true }),
    fetchList: async () => ({ raw: [] }),
    fetchDetail: async () => null,
    parse: () => [],
    normalize: () => null,
    validate: () => ({ ok: true }),
    rateLimit: { requestsPerMinute: 30 },
    fixtures: { list: "server/ingestion/sources/greenhouse/fixtures/list.json" }
  };

  assert.deepEqual(validateSourceContract(sourceModule), { ok: true, failures: [] });
});

test("source contract reports missing required functions", () => {
  const result = validateSourceContract({
    atsKey: "broken",
    family: SOURCE_FAMILIES.directJsonStable
  });

  assert.equal(result.ok, false);
  assert.ok(result.failures.includes("missing discover"));
  assert.ok(result.failures.includes("missing fetchList"));
  assert.ok(result.failures.includes("missing parse"));
  assert.ok(result.failures.includes("missing normalize"));
  assert.ok(result.failures.includes("missing validate"));
});

test("unsupported source module is typed and valid", async () => {
  const source = createUnsupportedSourceModule("dayforcehcm", {
    family: SOURCE_FAMILIES.enterpriseDirect,
    reason: "disabled until raw fixtures exist"
  });

  assert.deepEqual(validateSourceContract(source), { ok: true, failures: [] });
  assert.equal(source.status, SOURCE_STATUSES.unsupported);
  assert.equal((await source.fetchList()).ok, false);
});
