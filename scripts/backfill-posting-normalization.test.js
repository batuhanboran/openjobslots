const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildRejectedRowsQuery,
  getStoredRowRejectionReason,
  parseBackfillArgs,
  runBackfill,
  normalizeRowForBackfill,
  shouldChange,
  toSearchPayload
} = require("./backfill-posting-normalization");

function sampleRow(overrides = {}) {
  return {
    canonical_url: "https://example.com/jobs/123",
    company_name: "Example Co",
    position_name: "Software Engineer",
    apply_url: "https://example.com/jobs/123/apply",
    location_text: "Istanbul, Turkey",
    city: "",
    country: "",
    region: "",
    remote_type: "unknown",
    industry: "",
    department: "",
    employment_type: "",
    description_plain: "",
    description_html: "",
    ats_key: "exampleats",
    source_job_id: "",
    posting_date: "2026-05-01",
    posted_at_epoch: null,
    first_seen_epoch: 1770000000,
    last_seen_epoch: 1770000000,
    hidden: false,
    parser_version: "test-v1",
    confidence: 0.8,
    ...overrides
  };
}

function createDryRunPool(rows, rejectedRows = []) {
  let queried = false;
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/WITH rejected AS/i.test(sql)) {
        return { rows: rejectedRows };
      }
      if (/FROM postings/i.test(sql)) {
        if (queried) return { rows: [] };
        queried = true;
        return { rows };
      }
      return { rows: [] };
    },
    connect() {
      throw new Error("dry-run should not open write client");
    },
    async end() {}
  };
}

function createWritePool(rows, rejectedRows = []) {
  let queried = false;
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [], rowCount: 1 };
    },
    release() {
      calls.push({ sql: "RELEASE", params: [] });
    }
  };
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/WITH rejected AS/i.test(sql)) {
        return { rows: rejectedRows };
      }
      if (/FROM postings/i.test(sql)) {
        if (queried) return { rows: [] };
        queried = true;
        return { rows };
      }
      return { rows: [] };
    },
    async connect() {
      return client;
    },
    async end() {}
  };
}

test("backfill defaults to dry-run and requires explicit write mode", () => {
  assert.equal(parseBackfillArgs([], {}).dryRun, true);
  assert.equal(parseBackfillArgs([], {}).write, false);
  assert.equal(parseBackfillArgs(["--write"], {}).dryRun, false);
  assert.deepEqual(parseBackfillArgs(["--ats=icims,applitrack"], {}).atsFilter, ["icims", "applitrack"]);
  assert.equal(parseBackfillArgs(["--start-after=https://example.com/jobs/99"], {}).startAfter, "https://example.com/jobs/99");
});

test("backfill dry-run reports changes without writes", async () => {
  const pool = createDryRunPool([sampleRow()]);
  const summary = await runBackfill(
    pool,
    parseBackfillArgs(["--limit=1", "--sample-limit=1"], {}),
    { ensureSchema: async () => {}, logger: () => {} }
  );

  assert.equal(summary.dry_run, true);
  assert.equal(summary.scanned, 1);
  assert.equal(summary.changed, 1);
  assert.equal(summary.changed_by_field.country, 1);
  assert.equal(summary.changed_by_field.city, 1);
  assert.equal(summary.safe_backfill_fields.includes("city"), true);
  assert.equal(summary.refetch_required_fields.includes("description_html"), true);
  assert.equal(pool.calls.some((call) => /UPDATE postings/i.test(call.sql)), false);
  assert.equal(pool.calls.some((call) => /INSERT INTO search_index_outbox/i.test(call.sql)), false);
});

test("backfill reports existing invalid rows by reason", async () => {
  const pool = createDryRunPool([], [
    { ats_key: "careerplug", reason: "placeholder position_name", count: 3 },
    { ats_key: "icims", reason: "missing company_name", count: 2 }
  ]);
  const summary = await runBackfill(
    pool,
    parseBackfillArgs(["--limit=1"], {}),
    { ensureSchema: async () => {}, logger: () => {} }
  );

  assert.equal(summary.existing_invalid_rows, 5);
  assert.equal(summary.existing_invalid_rows_by_reason["placeholder position_name"], 3);
  assert.equal(summary.existing_invalid_rows_by_ats_and_reason.careerplug["placeholder position_name"], 3);
});

test("backfill rejects invalid candidate rows before write", async () => {
  const pool = createWritePool([sampleRow({ position_name: "Untitled", country: "" })]);
  const summary = await runBackfill(
    pool,
    parseBackfillArgs(["--write", "--limit=1", "--sample-limit=1"], {}),
    { ensureSchema: async () => {}, logger: () => {} }
  );

  assert.equal(summary.changed, 0);
  assert.equal(summary.rejected, 1);
  assert.equal(summary.rejected_by_reason["placeholder position_name"], 1);
  assert.equal(pool.calls.some((call) => /UPDATE postings/i.test(call.sql)), false);
  assert.equal(pool.calls.some((call) => /INSERT INTO search_index_outbox/i.test(call.sql)), false);
});

test("backfill ATS filter and start cursor are passed to candidate query", async () => {
  const pool = createDryRunPool([]);
  await runBackfill(
    pool,
    parseBackfillArgs(["--ats=icims", "--start-after=https://example.com/jobs/5"], {}),
    { ensureSchema: async () => {}, logger: () => {} }
  );

  const candidateCall = pool.calls.find((call) => /SELECT\s+canonical_url/i.test(call.sql));
  assert.deepEqual(candidateCall.params, ["https://example.com/jobs/5", 2000, ["icims"]]);
  assert.match(candidateCall.sql, /ats_key = ANY\(\$3::text\[\]\)/);
});

test("rejected rows query can be scoped by ATS", () => {
  const scoped = buildRejectedRowsQuery(["icims"]);
  const unscoped = buildRejectedRowsQuery([]);
  assert.match(scoped, /ats_key = ANY\(\$1::text\[\]\)/);
  assert.doesNotMatch(unscoped, /ats_key = ANY\(\$1::text\[\]\)/);
});

test("stored row rejection reason covers required fields", () => {
  assert.equal(getStoredRowRejectionReason(sampleRow({ canonical_url: "" })), "missing job_posting_url");
  assert.equal(getStoredRowRejectionReason(sampleRow({ canonical_url: "not-a-url" })), "invalid job_posting_url");
  assert.equal(getStoredRowRejectionReason(sampleRow({ company_name: "" })), "missing company_name");
  assert.equal(getStoredRowRejectionReason(sampleRow({ position_name: "" })), "missing position_name");
});

test("backfill dry-run fills source-backed department from stored category", async () => {
  const pool = createDryRunPool([sampleRow({
    industry: "Operations",
    department: "",
    location_text: "Remote"
  })]);
  const summary = await runBackfill(
    pool,
    parseBackfillArgs(["--limit=1", "--sample-limit=1"], {}),
    { ensureSchema: async () => {}, logger: () => {} }
  );

  assert.equal(summary.changed, 1);
  assert.equal(summary.changed_by_field.department, 1);
  assert.equal(summary.samples[0].after.department, "Operations");
});

test("backfill does not turn generic multi-location text into a city", () => {
  const row = sampleRow({
    location_text: "(Multiple states)",
    country: "",
    region: "",
    city: "",
    remote_type: "unknown"
  });
  const next = shouldChange(row, normalizeRowForBackfill(row));

  assert.equal(next.nextCity, "");
});

test("backfill write mode updates normalized fields and queues Meili outbox", async () => {
  const pool = createWritePool([sampleRow()]);
  const summary = await runBackfill(
    pool,
    parseBackfillArgs(["--write", "--limit=1"], {}),
    { ensureSchema: async () => {}, logger: () => {} }
  );

  assert.equal(summary.dry_run, false);
  assert.equal(summary.changed, 1);
  assert.ok(pool.calls.some((call) => /^BEGIN$/i.test(call.sql)));
  assert.ok(pool.calls.some((call) => /UPDATE postings/i.test(call.sql)));
  assert.ok(pool.calls.some((call) => /department = \$10/i.test(call.sql)));
  assert.ok(pool.calls.some((call) => /UPDATE posting_cache/i.test(call.sql)));
  assert.ok(pool.calls.some((call) => /INSERT INTO search_index_outbox/i.test(call.sql)));
  assert.ok(pool.calls.some((call) => /^COMMIT$/i.test(call.sql)));
});

test("backfill change detection includes city and search payload preserves it", () => {
  const row = sampleRow();
  const next = shouldChange(row, {
    country: "Turkey",
    region: "EMEA",
    city: "Istanbul",
    remote_type: "onsite",
    location_text: "Istanbul, Turkey",
    source_job_id: "123",
    posted_at_epoch: 1770000000,
    posting_date: "2026-05-01"
  });
  const payload = toSearchPayload(row, next);

  assert.equal(next.changed, true);
  assert.equal(next.nextCity, "Istanbul");
  assert.equal(payload.city, "Istanbul");
  assert.equal(payload.country, "Turkey");
});

test("backfill search payload includes source-backed optional fields", () => {
  const row = sampleRow({ industry: "Customer Success", department: "" });
  const next = shouldChange(row, {
    country: "Turkey",
    region: "EMEA",
    city: "Istanbul",
    remote_type: "onsite",
    location_text: "Istanbul, Turkey",
    source_job_id: "123",
    posted_at_epoch: 1770000000,
    posting_date: "2026-05-01",
    department: ""
  });
  const payload = toSearchPayload(row, next);

  assert.equal(next.nextDepartment, "Customer Success");
  assert.equal(payload.department, "Customer Success");
});
