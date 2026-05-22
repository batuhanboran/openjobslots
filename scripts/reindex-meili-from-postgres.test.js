const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { toMeiliPostingDocument, upsertMeiliPostings } = require("../server/search/meili");
const {
  ensureMeiliIndex,
  getReplaceSafetyGate,
  compareSettingList,
  compareMeiliDocument,
  compareFacetDistributions,
  indexablePostingsWhereClause,
  parseReindexArgs,
  runReindex,
  summarizeSampleMismatches,
  validateMeiliIndexAgainstPostgres,
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
  assert.equal(parseReindexArgs(["--replace-mode"], {}).replaceMode, true);
  assert.equal(parseReindexArgs(["--replace-mode", "--dry-run"], {}).replaceMode, true);
  assert.equal(parseReindexArgs(["--replace-mode", "--dry-run"], {}).dryRun, true);
  assert.equal(parseReindexArgs(["--json", "--output=reports/meili.json"], {}).json, true);
  assert.equal(parseReindexArgs(["--json", "--output=reports/meili.json"], {}).output, "reports/meili.json");
  assert.equal(parseReindexArgs(["--apply", "--confirm-production"], {}).apply, true);
  assert.equal(parseReindexArgs(["--apply", "--confirm-production"], {}).confirmProduction, true);
  assert.equal(getReplaceSafetyGate({ apply: true, confirmProduction: true, dryRun: false }).authorized, true);
  assert.equal(getReplaceSafetyGate({ apply: true, confirmProduction: false, dryRun: false }).authorized, false);
});

test("reindex check can write JSON output without mutating", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openjobslots-reindex-"));
  const outputPath = path.join(tmpDir, "check.json");
  const originalLog = console.log;
  console.log = () => {};
  try {
    const result = await runReindex(null, { check: true, output: outputPath });
    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
    const written = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    assert.equal(written.skipped, true);
  } finally {
    console.log = originalLog;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("reindex command skips safely when Postgres is not active", async () => {
  const originalLog = console.log;
  const logs = [];
  console.log = (message) => logs.push(message);
  try {
    const result = await runReindex(null, { check: true });
    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
    assert.match(result.reason, /not postgres/i);
    assert.ok(logs.some((message) => String(message).includes("Meili reindex checks require")));
  } finally {
    console.log = originalLog;
  }
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
  assert.equal(document.title_normalized, "software engineer");
  assert.equal(document.company, "Example Co");
  assert.equal(document.company_normalized, "example co");
  assert.equal(document.location, "Istanbul, Turkey");
  assert.equal(document.location_normalized, "istanbul turkey");
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

test("Meili sample mismatch summary separates missing documents from field drift", () => {
  const summary = summarizeSampleMismatches([
    {
      canonical_url: "https://example.com/missing",
      mismatches: [{ field: "id", expected: "abc", actual: null }]
    },
    {
      canonical_url: "https://example.com/field",
      mismatches: [
        { field: "country", expected: "Turkey", actual: "" },
        { field: "remote_type", expected: "remote", actual: "unknown" }
      ]
    }
  ]);

  assert.deepEqual(summary, {
    missing_documents: 1,
    field_mismatches: 2,
    fields: {
      country: 1,
      remote_type: 1
    }
  });
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
      rankingRules: ["words", "sort"],
      stopWords: [],
      synonyms: { turkey: ["turkiye"] },
      typoTolerance: { enabled: false, disableOnAttributes: [] }
    }
  );
  assert.equal(result.ok, false);
  assert.ok(result.mismatches.some((item) => item.setting === "primaryKey"));
  assert.ok(result.mismatches.some((item) => item.setting === "filterableAttributes"));
  assert.ok(result.mismatches.some((item) => item.setting === "sortableAttributes"));
  assert.ok(result.mismatches.some((item) => item.setting === "rankingRules"));
  assert.ok(result.mismatches.some((item) => item.setting === "stopWords"));
  assert.ok(result.mismatches.some((item) => item.setting === "typoTolerance.enabled"));
  assert.ok(result.mismatches.some((item) => item.setting === "typoTolerance.disableOnWords"));
  assert.ok(result.mismatches.some((item) => item.setting === "typoTolerance.minWordSizeForTypos.oneTypo"));
});

function createResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body || {});
    },
    async json() {
      return body || {};
    }
  };
}

function makePool({ count = 1, facet = { remote: 1 }, rows = [] } = {}) {
  let selectCalls = 0;
  const pool = {
    queries: [],
    async query(sql, params = []) {
      const queryText = String(sql || "");
      this.queries.push(queryText);
      if (/pg_try_advisory_lock/i.test(queryText)) return { rows: [{ locked: true }] };
      if (/pg_advisory_unlock/i.test(queryText)) return { rows: [{ unlocked: true }] };
      if (/UPDATE search_index_outbox/i.test(queryText)) return { rowCount: 0, rows: [] };
      if (/meili_remote_facet/i.test(queryText)) {
        const lastCanonicalUrl = String(params?.[0] || "");
        const limit = Math.max(1, Number(params?.[1] || 1000));
        const facetRows = [];
        const facetEntries = Object.entries(facet || {}).sort(([left], [right]) => left.localeCompare(right));
        for (const [remoteType, countValue] of facetEntries) {
          for (let index = 0; index < Number(countValue || 0); index += 1) {
            const canonicalUrl = `https://example.com/jobs/${remoteType}-${String(index).padStart(8, "0")}`;
            if (canonicalUrl <= lastCanonicalUrl) continue;
            facetRows.push(posting({
              canonical_url: canonicalUrl,
              remote_type: remoteType,
              location_text: remoteType === "onsite" ? "Istanbul, Turkey" : "",
              city: remoteType === "onsite" ? "Istanbul" : "",
              country: remoteType === "onsite" ? "Turkey" : "",
              region: remoteType === "onsite" ? "EMEA" : ""
            }));
            if (facetRows.length >= limit) return { rows: facetRows };
          }
        }
        return { rows: facetRows };
      }
      if (/GROUP BY 1/i.test(queryText)) {
        return { rows: Object.entries(facet).map(([remote_type, value]) => ({ remote_type, count: value })) };
      }
      if (/hidden = false\s+AND NOT/i.test(queryText)) return { rows: [{ count: 0 }] };
      if (/missing_canonical_url/i.test(queryText)) {
        return {
          rows: [{
            missing_canonical_url: 0,
            invalid_canonical_url: 0,
            missing_title: 0,
            missing_company: 0,
            placeholder_title: 0
          }]
        };
      }
      if (/COUNT\(\*\)::int AS count/i.test(queryText)) return { rows: [{ count }] };
      if (/SELECT\s+canonical_url/i.test(queryText)) {
        selectCalls += 1;
        return { rows: selectCalls === 1 ? rows : [] };
      }
      return { rows: [] };
    },
    async end() {
      this.ended = true;
    }
  };
  return pool;
}

function installFetchMock(handler) {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return handler(String(url), options, calls);
  };
  return {
    calls,
    restore() {
      global.fetch = originalFetch;
    }
  };
}

async function withSilencedConsole(callback) {
  const originalLog = console.log;
  console.log = () => {};
  try {
    return await callback();
  } finally {
    console.log = originalLog;
  }
}

function expectedSettingsResponse() {
  return {
    primaryKey: "id",
    ...MEILI_POSTINGS_SETTINGS
  };
}

test("replace reindex applies settings to the temp index before loading documents", async () => {
  const mock = installFetchMock((url, options) => {
    if (url.endsWith("/indexes/postings_tmp")) return createResponse(200, { uid: "postings_tmp", primaryKey: "id" });
    if (url.endsWith("/indexes/postings_tmp/settings") && options.method === "PATCH") {
      return createResponse(202, { taskUid: 10 });
    }
    if (url.endsWith("/tasks/10")) return createResponse(200, { uid: 10, status: "succeeded" });
    throw new Error(`Unexpected fetch ${options.method || "GET"} ${url}`);
  });
  try {
    await ensureMeiliIndex({ enabled: true, host: "http://meili.test", apiKey: "", indexName: "postings" }, "postings_tmp", 1000);
    const settingsPatch = mock.calls.find((call) => call.url.endsWith("/indexes/postings_tmp/settings"));
    assert.ok(settingsPatch);
    assert.deepEqual(JSON.parse(settingsPatch.options.body), MEILI_POSTINGS_SETTINGS);
  } finally {
    mock.restore();
  }
});

test("replace reindex dry-run reports plan without mutating Meili", async () => {
  const mock = installFetchMock(() => {
    throw new Error("dry-run should not call Meili");
  });
  const pool = makePool({ count: 42 });
  try {
    const result = await withSilencedConsole(() =>
      runReindex(
        pool,
        { replaceMode: true, apply: false, confirmProduction: false, dryRun: false, tempIndexSuffix: "dry", batchSize: 1000, sampleLimit: 0, writeStatus: false },
        { OPENJOBSLOTS_SEARCH_BACKEND: "meili", MEILI_HOST: "http://meili.test" }
      )
    );
    assert.equal(result.dry_run, true);
    assert.equal(result.postgres_indexable_count, 42);
    assert.equal(mock.calls.length, 0);
    assert.ok(pool.ended);
  } finally {
    mock.restore();
  }
});

test("replace reindex can skip Postgres outbox mutation after swap", async () => {
  const mock = installFetchMock((url, options) => {
    if (url.endsWith("/indexes/postings_skip")) return createResponse(200, { uid: "postings_skip", primaryKey: "id" });
    if (url.endsWith("/indexes") && options.method === "POST") return createResponse(202, { taskUid: 1 });
    if (url.endsWith("/tasks/1")) return createResponse(200, { uid: 1, status: "succeeded" });
    if (url.endsWith("/indexes/postings_skip/settings") && options.method === "PATCH") return createResponse(202, { taskUid: 2 });
    if (url.endsWith("/tasks/2")) return createResponse(200, { uid: 2, status: "succeeded" });
    if (url.endsWith("/indexes/postings_skip/documents") && options.method === "POST") return createResponse(202, { taskUid: 3 });
    if (url.endsWith("/tasks/3")) return createResponse(200, { uid: 3, status: "succeeded" });
    if (url.endsWith("/indexes/postings_skip/settings")) return createResponse(200, expectedSettingsResponse());
    if (url.endsWith("/indexes/postings_skip/stats")) return createResponse(200, { numberOfDocuments: 1 });
    if (url.endsWith("/indexes/postings_skip/search")) {
      return createResponse(200, { facetDistribution: { remote_type: { onsite: 1 } }, hits: [], estimatedTotalHits: 1 });
    }
    if (url.endsWith("/swap-indexes")) return createResponse(202, { taskUid: 4 });
    if (url.endsWith("/tasks/4")) return createResponse(200, { uid: 4, status: "succeeded" });
    if (url.endsWith("/indexes/postings")) return createResponse(200, { uid: "postings", primaryKey: "id" });
    if (url.endsWith("/indexes/postings/settings")) return createResponse(200, expectedSettingsResponse());
    if (url.endsWith("/indexes/postings/stats")) return createResponse(200, { numberOfDocuments: 1 });
    if (url.endsWith("/indexes/postings/search")) {
      return createResponse(200, { facetDistribution: { remote_type: { onsite: 1 } }, hits: [], estimatedTotalHits: 1 });
    }
    throw new Error(`Unexpected fetch ${options.method || "GET"} ${url}`);
  });
  const pool = makePool({ count: 1, facet: { onsite: 1 }, rows: [posting()] });
  try {
    const result = await withSilencedConsole(() =>
      runReindex(
        pool,
        {
          replaceMode: true,
          apply: true,
          confirmProduction: true,
          dryRun: false,
          tempIndexSuffix: "skip",
          batchSize: 100,
          sampleLimit: 0,
          taskTimeoutMs: 1000,
          skipOutboxUpdate: true,
          writeStatus: false
        },
        { OPENJOBSLOTS_SEARCH_BACKEND: "meili", MEILI_HOST: "http://meili.test" }
      )
    );
    assert.equal(result.ok, true);
    assert.equal(result.swapped, true);
    assert.equal(result.outbox_update_skipped, true);
    assert.equal(result.outbox_processed, 0);
    assert.equal(pool.queries.some((query) => /UPDATE search_index_outbox/i.test(query)), false);
  } finally {
    mock.restore();
  }
});

test("replace validation catches count mismatch", async () => {
  const mock = installFetchMock((url, options) => {
    if (url.endsWith("/indexes/postings_tmp")) return createResponse(200, { uid: "postings_tmp", primaryKey: "id" });
    if (url.endsWith("/indexes/postings_tmp/settings")) return createResponse(200, expectedSettingsResponse());
    if (url.endsWith("/indexes/postings_tmp/stats")) return createResponse(200, { numberOfDocuments: 2 });
    if (url.endsWith("/indexes/postings_tmp/search")) {
      return createResponse(200, { facetDistribution: { remote_type: { remote: 1, onsite: 1 } }, hits: [], estimatedTotalHits: 0 });
    }
    if (url.includes("/indexes/postings_tmp/documents?")) {
      return createResponse(200, {
        results: [
          {
            id: toMeiliPostingDocument(posting({ canonical_url: "https://example.com/jobs/remote-00000000", remote_type: "remote" })).id,
            canonical_url: "https://example.com/jobs/remote-00000000",
            title: "Software Engineer",
            company: "Example Co",
            remote_type: "remote",
            hidden: false
          },
          {
            id: "stale-id",
            canonical_url: "https://example.com/jobs/stale-open-position",
            title: "Open Position",
            company: "Demo Co",
            remote_type: "onsite",
            hidden: false
          }
        ]
      });
    }
    throw new Error(`Unexpected fetch ${options.method || "GET"} ${url}`);
  });
  try {
    const result = await validateMeiliIndexAgainstPostgres(
      makePool({ count: 1, facet: { remote: 1 }, rows: [posting({ canonical_url: "https://example.com/jobs/remote-00000000", remote_type: "remote" })] }),
      { enabled: true, host: "http://meili.test", apiKey: "", indexName: "postings" },
      "postings_tmp",
      { sampleLimit: 0, sampleSearches: false }
    );
    assert.equal(result.ok, false);
    assert.equal(result.count_delta, -1);
    assert.equal(result.extra_meili_document_count, 1);
    assert.deepEqual(result.extra_meili_documents, [
      {
        id: "stale-id",
        canonical_url: "https://example.com/jobs/stale-open-position",
        title: "Open Position",
        company: "Demo Co",
        remote_type: "onsite",
        hidden: false
      }
    ]);
  } finally {
    mock.restore();
  }
});

test("replace validation catches remote facet mismatch", async () => {
  assert.deepEqual(compareFacetDistributions({ remote: 2 }, { remote: 1, unknown: 1 }).deltas, {
    remote: { expected: 2, actual: 1, delta: 1 },
    unknown: { expected: 0, actual: 1, delta: -1 }
  });
  const mock = installFetchMock((url, options) => {
    if (url.endsWith("/indexes/postings_tmp")) return createResponse(200, { uid: "postings_tmp", primaryKey: "id" });
    if (url.endsWith("/indexes/postings_tmp/settings")) return createResponse(200, expectedSettingsResponse());
    if (url.endsWith("/indexes/postings_tmp/stats")) return createResponse(200, { numberOfDocuments: 2 });
    if (url.endsWith("/indexes/postings_tmp/search")) {
      return createResponse(200, { facetDistribution: { remote_type: { remote: 1, unknown: 1 } }, hits: [], estimatedTotalHits: 0 });
    }
    throw new Error(`Unexpected fetch ${options.method || "GET"} ${url}`);
  });
  try {
    const result = await validateMeiliIndexAgainstPostgres(
      makePool({ count: 2, facet: { remote: 2 } }),
      { enabled: true, host: "http://meili.test", apiKey: "", indexName: "postings" },
      "postings_tmp",
      { sampleLimit: 0, sampleSearches: false }
    );
    assert.equal(result.ok, false);
    assert.equal(result.remote_facet_delta.remote.delta, 1);
    assert.equal(result.remote_facet_delta.unknown.delta, -1);
  } finally {
    mock.restore();
  }
});

test("replace swap is not attempted if temp validation fails", async () => {
  const mock = installFetchMock((url, options) => {
    if (url.endsWith("/indexes/postings_bad")) return createResponse(404, {});
    if (url.endsWith("/indexes") && options.method === "POST") return createResponse(202, { taskUid: 1 });
    if (url.endsWith("/tasks/1")) return createResponse(200, { uid: 1, status: "succeeded" });
    if (url.endsWith("/indexes/postings_bad/settings") && options.method === "PATCH") return createResponse(202, { taskUid: 2 });
    if (url.endsWith("/tasks/2")) return createResponse(200, { uid: 2, status: "succeeded" });
    if (url.endsWith("/indexes/postings_bad/documents") && options.method === "POST") return createResponse(202, { taskUid: 3 });
    if (url.endsWith("/tasks/3")) return createResponse(200, { uid: 3, status: "succeeded" });
    if (url.endsWith("/indexes/postings_bad/settings")) return createResponse(200, expectedSettingsResponse());
    if (url.endsWith("/indexes/postings_bad/stats")) return createResponse(200, { numberOfDocuments: 0 });
    if (url.endsWith("/indexes/postings_bad/search")) {
      return createResponse(200, { facetDistribution: { remote_type: {} }, hits: [], estimatedTotalHits: 0 });
    }
    if (url.endsWith("/swap-indexes")) throw new Error("swap should not be attempted");
    throw new Error(`Unexpected fetch ${options.method || "GET"} ${url}`);
  });
  try {
    const result = await withSilencedConsole(() =>
      runReindex(
        makePool({ count: 1, facet: { remote: 1 }, rows: [posting()] }),
        {
          replaceMode: true,
          apply: true,
          confirmProduction: true,
          dryRun: false,
          tempIndexSuffix: "bad",
          batchSize: 100,
          sampleLimit: 0,
          taskTimeoutMs: 1000,
          writeStatus: false
        },
        { OPENJOBSLOTS_SEARCH_BACKEND: "meili", MEILI_HOST: "http://meili.test" }
      )
    );
    assert.equal(result.ok, false);
    assert.equal(result.swapped, false);
    assert.equal(mock.calls.some((call) => call.url.endsWith("/swap-indexes")), false);
  } finally {
    mock.restore();
  }
});
