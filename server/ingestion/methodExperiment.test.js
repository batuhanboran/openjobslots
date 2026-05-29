const assert = require("node:assert/strict");
const { ALLOWED_EXPERIMENT_SOURCES, runMethodExperiment, inspectDetailHtml } = require("./methodExperiment");

function makePool(existingRows = []) {
  const queries = [];
  return {
    queries,
    async query(sql) {
      queries.push(String(sql));
      return { rows: existingRows };
    }
  };
}

function makeTarget(rows, options = {}) {
  return {
    atsKey: options.source || "applytojob",
    companyUrl: options.url || "https://fixture.applytojob.com/apply",
    host: options.host || "fixture.applytojob.com",
    company: {
      id: 1,
      company_name: options.company || "Fixture Company",
      url_string: options.url || "https://fixture.applytojob.com/apply",
      ATS_name: options.source || "applytojob"
    },
    adapter: {
      parserVersion: "source-applytojob-v1",
      metadata: { sourceFamily: "html_detail" },
      async fetch() {
        if (options.fetchError) throw options.fetchError;
        return { html: "<html><body>fixture</body></html>" };
      },
      parse() {
        if (options.parseError) throw options.parseError;
        if (options.emptyParse) return [];
        return rows;
      },
      normalize(item) {
        return {
          ...item,
          ats_key: options.source || "applytojob",
          parser_key: options.source || "applytojob",
          parser_version: "source-applytojob-v1",
          parser_confidence: 0.75,
          source_family: "html_detail"
        };
      },
      validate() {
        return { ok: true, status: "valid", error: "" };
      },
      async fetchDetail() {
        return null;
      }
    },
    sourcePolicy: { source_quality_state: "public_enabled" }
  };
}

function cleanRow(patch = {}) {
  return {
    source_job_id: "job-1",
    company_name: "Fixture Company",
    position_name: "Engineer",
    canonical_url: "https://fixture.applytojob.com/apply/job-1",
    job_posting_url: "https://fixture.applytojob.com/apply/job-1",
    country: "Turkey",
    region: "Istanbul",
    city: "Istanbul",
    location_text: "Istanbul, Turkey",
    remote_type: "onsite",
    posting_date: "2026-05-01",
    ...patch
  };
}

async function runFixture(rows, options = {}) {
  return runMethodExperiment({
    source: options.source || "applytojob",
    pool: options.pool || makePool(options.existingRows || []),
    targets: [makeTarget(rows, options.target || {})],
    configuredTargets: 1,
    requestedLimit: 1,
    limit: 1,
    rowLimit: 20,
    detailSampleLimit: options.detailSampleLimit ?? 5,
    fetchDetail: options.fetchDetail
  });
}

async function testLogsListOnlyMethod() {
  const report = await runFixture([cleanRow()]);
  assert.equal(report.ok, true);
  assert.equal(report.rows_parsed, 1);
  assert.equal(report.accepted_candidates, 1);
  assert.equal(report.net_new_clean_candidates, 1);
  assert.equal(report.tenant_reports[0].method_attempts.includes("list_only"), true);
}

async function testLogsDetailMethod() {
  const detailHtml = `
    <html><head><link rel="canonical" href="https://fixture.applytojob.com/apply/job-2"></head>
    <body><strong>Location:</strong><span>Boston, MA</span>
    <strong>Work Type:</strong><span>Hybrid</span>
    <strong>Date Posted:</strong><span>May 1, 2026</span></body></html>
  `;
  const report = await runFixture([
    cleanRow({
      source_job_id: "job-2",
      canonical_url: "https://fixture.applytojob.com/apply/job-2",
      job_posting_url: "https://fixture.applytojob.com/apply/job-2",
      country: "",
      region: "",
      city: "",
      location_text: "",
      remote_type: "unknown",
      posting_date: ""
    })
  ], {
    fetchDetail: async () => ({ status: 200, text: detailHtml })
  });
  const tenant = report.tenant_reports[0];
  assert.equal(tenant.detail_methods.attempted, 1);
  assert.equal(tenant.detail_methods.labeled_location, 1);
  assert.equal(tenant.detail_methods.labeled_remote_or_work_type, 1);
  assert.equal(tenant.detail_methods.labeled_posting_date, 1);
  assert.equal(tenant.method_attempts.includes("labeled_html"), true);
}

async function testLogsUnsupportedShape() {
  const report = await runMethodExperiment({
    source: "applytojob",
    pool: makePool(),
    targets: [makeTarget([], { parseError: new Error("unexpected layout") })],
    configuredTargets: 1,
    requestedLimit: 1,
    limit: 1,
    rowLimit: 20,
    detailSampleLimit: 0
  });
  assert.equal(report.parser_failure_reasons.unsupported_html_shape, 1);
  assert.equal(report.tenant_reports[0].best_method, "unsupported_html_shape");
}

async function testLogsNoGeoNoRemote() {
  const report = await runFixture([
    cleanRow({
      source_job_id: "job-3",
      canonical_url: "https://fixture.applytojob.com/apply/job-3",
      job_posting_url: "https://fixture.applytojob.com/apply/job-3",
      country: "",
      region: "",
      city: "",
      location_text: "",
      remote_type: "unknown"
    })
  ], { detailSampleLimit: 0 });
  assert.equal(report.no_geo_no_remote_candidates, 1);
  assert.equal(report.classifications.no_geo_no_remote, 1);
  assert.equal(report.parser_failure_reasons.no_geo_no_remote >= 1, true);
}

async function testLogsDuplicateExistingPublic() {
  const existingRows = [{
    canonical_url: "https://fixture.applytojob.com/apply/job-4",
    apply_url: "",
    ats_key: "applytojob",
    source_job_id: "job-4",
    hidden: false,
    city: "Istanbul",
    country: "Turkey",
    region: "Istanbul",
    location_text: "Istanbul, Turkey",
    remote_type: "onsite",
    position_name: "Engineer",
    company_name: "Fixture Company"
  }];
  const report = await runFixture([
    cleanRow({
      source_job_id: "job-4",
      canonical_url: "https://fixture.applytojob.com/apply/job-4",
      job_posting_url: "https://fixture.applytojob.com/apply/job-4"
    })
  ], { existingRows });
  assert.equal(report.duplicates, 1);
  assert.equal(report.classifications.already_public_same_source_job_id, 1);
}

async function testDoesNotMutateDb() {
  const pool = makePool();
  await runFixture([cleanRow({ source_job_id: "job-5", canonical_url: "https://fixture.applytojob.com/apply/job-5" })], { pool });
  const combined = pool.queries.join("\n");
  assert.equal(/\b(insert|update|delete|truncate|alter|drop|create)\b/i.test(combined), false, combined);
}

function testDetailInspector() {
  const inspected = inspectDetailHtml(`
    <script type="application/ld+json">{"@type":"JobPosting","title":"Engineer"}</script>
    <script id="__NEXT_DATA__" type="application/json">{}</script>
    <b>Location:</b><span>Remote</span>
  `, "https://fixture.breezy.hr/p/job-1");
  assert.equal(inspected.json_ld_jobposting, true);
  assert.equal(inspected.embedded_json, true);
  assert.equal(inspected.labeled_location, true);
}

function testPhaseTwoSourcesAreAllowed() {
  assert.ok(ALLOWED_EXPERIMENT_SOURCES.has("teamtailor"));
  assert.ok(ALLOWED_EXPERIMENT_SOURCES.has("icims"));
  assert.ok(ALLOWED_EXPERIMENT_SOURCES.has("applitrack"));
  assert.ok(ALLOWED_EXPERIMENT_SOURCES.has("greenhouse"));
  assert.ok(ALLOWED_EXPERIMENT_SOURCES.has("lever"));
}

async function main() {
  await testLogsListOnlyMethod();
  await testLogsDetailMethod();
  await testLogsUnsupportedShape();
  await testLogsNoGeoNoRemote();
  await testLogsDuplicateExistingPublic();
  await testDoesNotMutateDb();
  testDetailInspector();
  testPhaseTwoSourcesAreAllowed();
  console.log("methodExperiment tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
