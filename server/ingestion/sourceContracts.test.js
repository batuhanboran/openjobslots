const assert = require("node:assert/strict");
const test = require("node:test");

const {
  SOURCE_FAMILIES,
  SOURCE_STATUSES,
  createUnsupportedSourceModule,
  validateSourceContract,
  validateSourceRecoveryContract
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

test("source recovery contract requires public gate, thresholds, rate limit, and fixtures", () => {
  const sourceModule = {
    atsKey: "greenhouse",
    family: SOURCE_FAMILIES.directJsonStable,
    status: SOURCE_STATUSES.enabled,
    discover: () => ({ ok: true }),
    fetchList: async () => ({ raw: [] }),
    parse: () => [],
    normalize: () => null,
    validate: () => ({ ok: true }),
    validatePublic: () => ({ status: "accepted" }),
    rateLimit: () => ({ requestsPerMinute: 30 }),
    qualityThreshold: () => ({ public_requires_geo_or_explicit_remote: true }),
    fixtures: () => [
      "server/ingestion/sources/greenhouse/fixtures/list.json",
      "server/ingestion/sources/greenhouse/fixtures/expected-normalized.json",
      "server/ingestion/sources/greenhouse/fixtures/invalid-shapes.json"
    ]
  };

  assert.deepEqual(validateSourceRecoveryContract(sourceModule), {
    ok: true,
    failures: [],
    unsupported: false
  });
});

test("source recovery contract reports recovery-specific gaps", () => {
  const result = validateSourceRecoveryContract({
    atsKey: "peopleforce",
    family: SOURCE_FAMILIES.vendorSpecific,
    status: SOURCE_STATUSES.disabled,
    discover: () => ({ ok: true }),
    fetchList: async () => ({ raw: [] }),
    parse: () => [],
    normalize: () => null,
    validate: () => ({ ok: true }),
    fixtures: () => []
  });

  assert.equal(result.ok, false);
  assert.equal(result.unsupported, false);
  assert.ok(result.failures.includes("missing validatePublic"));
  assert.ok(result.failures.includes("missing rateLimit"));
  assert.ok(result.failures.includes("missing qualityThreshold"));
  assert.ok(result.failures.includes("missing fixture paths"));
});

test("unsupported source recovery contract is valid but marked unsupported", () => {
  const source = createUnsupportedSourceModule("dayforcehcm", {
    family: SOURCE_FAMILIES.enterpriseDirect,
    reason: "disabled until raw fixtures exist"
  });

  assert.deepEqual(validateSourceRecoveryContract(source), {
    ok: true,
    failures: [],
    unsupported: true
  });
});
