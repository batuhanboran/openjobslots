const assert = require("node:assert/strict");
const test = require("node:test");
const { toMeiliPostingDocument, upsertMeiliPostings } = require("../server/search/meili");
const {
  compareSettingList,
  compareMeiliDocument,
  indexablePostingsWhereClause,
  parseReindexArgs,
  validateMeiliSettings
} = require("./reindex-meili-from-postgres");
const { MEILI_POSTINGS_SETTINGS } = require("../server/search/meili");

function posting(overrides = {}) {
  return {
    canonical_url: "https://example.com/jobs/123",
    company_name: "Example Co",
    position_name: "Software Engineer",
    apply_url: "https://example.com/jobs/123/apply",
    location_text: "Istanbul, Turkey",
    city: "Istanbul",
    country: "Turkey",
    region: "EMEA",
    remote_type: "onsite",
    industry: "",
    department: "Engineering",
    employment_type: "Full-time",
    description_plain: "Build useful software.",
    ats_key: "exampleats",
    source_job_id: "123",
    posting_date: "2026-05-01",
    posted_at_epoch: 1770000000,
    last_seen_epoch: 1770000001,
    hidden: false,
    ...overrides
  };
}

test("reindex check mode is explicit and non-mutating", () => {
  assert.equal(parseReindexArgs(["--check"], {}).check, true);
  assert.equal(parseReindexArgs(["--dry-run"], {}).check, true);
  assert.equal(parseReindexArgs([], {}).check, false);
  assert.equal(parseReindexArgs(["--replace"], {}).replaceIndex, true);
});

test("reindex query excludes bad visible rows before indexing", () => {
  const where = indexablePostingsWhereClause();
  assert.match(where, /hidden = false/);
  assert.match(where, /canonical_url/);
  assert.match(where, /position_name/);
  assert.match(where, /company_name/);
  assert.match(where, /untitled/);
});

test("Meili document conversion preserves required normalized fields", () => {
  const document = toMeiliPostingDocument(posting());
  assert.equal(document.canonical_url, "https://example.com/jobs/123");
  assert.equal(document.title, "Software Engineer");
  assert.equal(document.company, "Example Co");
  assert.equal(document.location, "Istanbul, Turkey");
  assert.equal(document.city, "Istanbul");
  assert.equal(document.country, "Turkey");
  assert.equal(document.region, "EMEA");
  assert.equal(document.remote_type, "onsite");
  assert.equal(document.source_job_id, "123");
  assert.equal(document.posted_at_epoch, 1770000000);
});

test("bad rows are not sent to Meili upsert", async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return {
      ok: true,
      status: 202,
      async json() {
        return { taskUid: 1 };
      }
    };
  };
  try {
    const result = await upsertMeiliPostings(
      [
        posting(),
        posting({ canonical_url: "not-a-url" }),
        posting({ position_name: "" }),
        posting({ company_name: "" })
      ],
      { enabled: true, host: "http://meili.test", apiKey: "", indexName: "postings" }
    );
    assert.equal(result.taskUid, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.length, 1);
    assert.equal(calls[0].body[0].canonical_url, "https://example.com/jobs/123");
  } finally {
    global.fetch = originalFetch;
  }
});

test("Meili parity comparison reports field mismatches", () => {
  const mismatches = compareMeiliDocument(posting(), {
    ...toMeiliPostingDocument(posting()),
    country: "",
    remote_type: "unknown"
  });
  assert.deepEqual(mismatches.map((item) => item.field), ["country", "remote_type"]);
});

test("Meili settings validation accepts expected production settings", () => {
  const result = validateMeiliSettings({ primaryKey: "id" }, MEILI_POSTINGS_SETTINGS);
  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
});

test("Meili settings validation reports missing filter/sort/search fields", () => {
  const listMismatch = compareSettingList("filterableAttributes", ["country"], ["country", "hidden"]);
  assert.deepEqual(listMismatch, { setting: "filterableAttributes", missing: ["hidden"], extra: [] });

  const result = validateMeiliSettings(
    { primaryKey: "canonical_url" },
    {
      ...MEILI_POSTINGS_SETTINGS,
      filterableAttributes: ["country"],
      sortableAttributes: ["last_seen_epoch"],
      synonyms: { turkey: ["turkiye"] },
      typoTolerance: { enabled: false, disableOnAttributes: [] }
    }
  );
  assert.equal(result.ok, false);
  assert.ok(result.mismatches.some((item) => item.setting === "primaryKey"));
  assert.ok(result.mismatches.some((item) => item.setting === "filterableAttributes"));
  assert.ok(result.mismatches.some((item) => item.setting === "sortableAttributes"));
  assert.ok(result.mismatches.some((item) => item.setting === "typoTolerance.enabled"));
});
