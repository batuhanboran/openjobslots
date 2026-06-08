const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3");
const {
  detailUrlForRow,
  extractDetailFields,
  getSafetyGate,
  isAllowedDetailUrl,
  planDetailChanges,
  runDetailRefetch
} = require("./detailRefetchPlanner");

const fixtureDir = path.join(__dirname, "..", "fixtures", "detail-refetch");

function readFixture(name) {
  return fs.readFileSync(path.join(fixtureDir, name), "utf8");
}

function openWritableSqlite(filename) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filename, (error) => {
      if (error) reject(error);
      else {
        resolve({
          exec(sql) {
            return new Promise((innerResolve, innerReject) => {
              db.exec(sql, (execError) => {
                if (execError) innerReject(execError);
                else innerResolve();
              });
            });
          },
          all(sql, params = []) {
            return new Promise((innerResolve, innerReject) => {
              db.all(sql, params, (queryError, rows) => {
                if (queryError) innerReject(queryError);
                else innerResolve(rows || []);
              });
            });
          },
          close() {
            return new Promise((innerResolve, innerReject) => {
              db.close((closeError) => {
                if (closeError) innerReject(closeError);
                else innerResolve();
              });
            });
          }
        });
      }
    });
  });
}

function baseRow(overrides = {}) {
  return {
    canonical_url: "https://fixtureco.icims.com/jobs/1001/support-engineer/job",
    company_name: "Fixture Company",
    position_name: "Support Engineer",
    apply_url: "",
    location_text: "",
    city: "",
    country: "",
    region: "",
    remote_type: "unknown",
    ats_key: "icims",
    source_job_id: "",
    posting_date: null,
    posted_at_epoch: null,
    first_seen_epoch: 1770000000,
    last_seen_epoch: 1770000100,
    hidden: false,
    parser_version: "legacy-adapter-v1",
    confidence: 0.75,
    department: "",
    quality_score: 0,
    quality_flags: "[]",
    ...overrides
  };
}

async function createTestDb() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openjobslots-detail-refetch-"));
  const dbPath = path.join(tempDir, "jobs.db");
  const db = await openWritableSqlite(dbPath);
  await db.exec(`
    CREATE TABLE Postings (
      company_name TEXT,
      position_name TEXT,
      job_posting_url TEXT,
      apply_url TEXT,
      ats_key TEXT,
      source_job_id TEXT,
      parser_version TEXT,
      confidence REAL,
      location_text TEXT,
      location TEXT,
      city TEXT,
      country TEXT,
      region TEXT,
      remote_type TEXT,
      department TEXT,
      posting_date TEXT,
      posted_at_epoch INTEGER,
      first_seen_epoch INTEGER,
      last_seen_epoch INTEGER,
      quality_score INTEGER NOT NULL DEFAULT 0,
      quality_flags TEXT NOT NULL DEFAULT '[]',
      hidden INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO Postings (
      company_name, position_name, job_posting_url, apply_url, ats_key, source_job_id,
      parser_version, confidence, location_text, location, city, country, region, remote_type,
      department, posting_date, posted_at_epoch, first_seen_epoch, last_seen_epoch, quality_score, quality_flags, hidden
    ) VALUES
      ('Fixture iCIMS', 'Technical Support Engineer', 'https://fixtureco.icims.com/jobs/1001/support-engineer/job', '', 'icims', '', 'legacy-adapter-v1', 0.75, '', '', '', '', '', 'unknown', '', NULL, NULL, 1770000000, 1770000100, 0, '[]', 0),
      ('Fixture Applitrack', 'Teacher - English Language Arts', 'https://www.applitrack.com/fixtureco/onlineapp/default.aspx?JobID=5503511', '', 'applitrack', '', 'legacy-adapter-v1', 0.75, '', '', '', '', '', 'unknown', '', NULL, NULL, 1770000000, 1770000100, 0, '[]', 0),
      ('Fixture iCIMS', 'Existing Remote', 'https://fixtureco.icims.com/jobs/1002/existing-remote/job', '', 'icims', '', 'legacy-adapter-v1', 0.9, '', '', '', 'United States', 'North America', 'remote', '', NULL, NULL, 1770000000, 1770000100, 100, '[]', 0),
      ('Fixture iCIMS', 'Blocked Source', 'https://example.test/jobs/404', '', 'icims', '', 'legacy-adapter-v1', 0.75, '', '', '', '', '', 'unknown', '', NULL, NULL, 1770000000, 1770000100, 0, '[]', 0);
  `);
  await db.close();
  return dbPath;
}

test("iCIMS detail fixtures extract geo, posted date, and remote evidence", () => {
  const detail = extractDetailFields(baseRow(), readFixture("icims-detail-geo.html"));
  const plan = planDetailChanges(baseRow(), detail);
  const country = plan.changes.find((item) => item.field === "country");
  const city = plan.changes.find((item) => item.field === "city");
  const remote = plan.changes.find((item) => item.field === "remote_type");
  const date = plan.changes.find((item) => item.field === "posting_date");
  assert.equal(country.after, "United States");
  assert.equal(city.after, "Philadelphia");
  assert.equal(remote.after, "onsite");
  assert.equal(date.after, "2026-04-20");
});

test("iCIMS remote fixture extracts remote from explicit source labels", () => {
  const detail = extractDetailFields(baseRow(), readFixture("icims-detail-remote.html"));
  const plan = planDetailChanges(baseRow(), detail);
  assert.equal(plan.changes.find((item) => item.field === "remote_type").after, "remote");
  assert.equal(plan.changes.find((item) => item.field === "country").after, "United States");
});

test("Applitrack detail fixtures extract geo/date/department and remote/hybrid evidence", () => {
  const row = baseRow({
    ats_key: "applitrack",
    canonical_url: "https://www.applitrack.com/fixtureco/onlineapp/default.aspx?JobID=5503511",
    position_name: "Teacher - English Language Arts"
  });
  const geoPlan = planDetailChanges(row, extractDetailFields(row, readFixture("applitrack-detail-geo.html")));
  assert.equal(geoPlan.changes.find((item) => item.field === "country").after, "United States");
  assert.equal(geoPlan.changes.find((item) => item.field === "city").after, "Abilene");
  assert.equal(geoPlan.changes.find((item) => item.field === "posting_date").after, "4/12/2026");
  assert.equal(geoPlan.changes.find((item) => item.field === "department").after, "Teacher");

  const remotePlan = planDetailChanges(row, extractDetailFields(row, readFixture("applitrack-detail-remote.html")));
  assert.equal(remotePlan.changes.find((item) => item.field === "remote_type").after, "hybrid");
});

test("apply mode requires all explicit safety flags", () => {
  assert.equal(getSafetyGate({ apply: true, confirmProduction: true, backupConfirmed: true, maxUpdates: 0 }).authorized, false);
  assert.equal(getSafetyGate({ apply: true, confirmProduction: false, backupConfirmed: true, maxUpdates: 1 }).authorized, false);
  assert.equal(getSafetyGate({ apply: true, confirmProduction: true, backupConfirmed: true, maxUpdates: 1 }).authorized, true);
});

test("dry-run detail refetch does not mutate SQLite rows", async () => {
  const dbPath = await createTestDb();
  const icimsRow = baseRow({ canonical_url: "https://fixtureco.icims.com/jobs/1001/support-engineer/job" });
  const applitrackRow = baseRow({
    ats_key: "applitrack",
    canonical_url: "https://www.applitrack.com/fixtureco/onlineapp/default.aspx?JobID=5503511"
  });
  const detailByUrl = {
    [detailUrlForRow(icimsRow)]: readFixture("icims-detail-geo.html"),
    [detailUrlForRow(applitrackRow)]: readFixture("applitrack-detail-geo.html")
  };

  const report = await runDetailRefetch(
    { sources: ["icims", "applitrack"], limit: 4, companyLimit: 4, sample: 2, delayMs: 0, jitterMs: 0, detailByUrl },
    { OPENJOBSLOTS_DB_BACKEND: "sqlite", DB_PATH: dbPath }
  );
  assert.equal(report.dry_run, true);
  assert.equal(report.planned_rows, 2);

  const db = await openWritableSqlite(dbPath);
  try {
    const rows = await db.all("SELECT country, city, remote_type FROM Postings WHERE job_posting_url LIKE '%1001%';");
    assert.deepEqual(rows[0], { country: "", city: "", remote_type: "unknown" });
  } finally {
    await db.close();
  }
});

test("guarded apply updates only safe rows, writes audit trail, and does not downgrade explicit remote", async () => {
  const dbPath = await createTestDb();
  const icimsRow = baseRow({ canonical_url: "https://fixtureco.icims.com/jobs/1001/support-engineer/job" });
  const existingRemoteRow = baseRow({
    canonical_url: "https://fixtureco.icims.com/jobs/1002/existing-remote/job",
    country: "United States",
    region: "North America",
    remote_type: "remote"
  });
  const detailByUrl = {
    [detailUrlForRow(icimsRow)]: readFixture("icims-detail-geo.html"),
    [detailUrlForRow(existingRemoteRow)]: readFixture("icims-detail-remote.html")
  };

  const report = await runDetailRefetch(
    {
      sources: ["icims"],
      limit: 3,
      companyLimit: 3,
      sample: 3,
      delayMs: 0,
      jitterMs: 0,
      detailByUrl,
      apply: true,
      confirmProduction: true,
      backupConfirmed: true,
      maxUpdates: 2,
      batchSize: 1
    },
    { OPENJOBSLOTS_DB_BACKEND: "sqlite", DB_PATH: dbPath }
  );
  assert.equal(report.apply_mode, true);
  assert.ok(report.applied_rows >= 1);

  const db = await openWritableSqlite(dbPath);
  try {
    const changed = await db.all("SELECT country, city, remote_type, posting_date FROM Postings WHERE job_posting_url LIKE '%1001%';");
    assert.deepEqual(changed[0], {
      country: "United States",
      city: "Philadelphia",
      remote_type: "onsite",
      posting_date: "2026-04-20"
    });
    const noDowngrade = await db.all("SELECT country, remote_type FROM Postings WHERE job_posting_url LIKE '%1002%';");
    assert.deepEqual(noDowngrade[0], { country: "United States", remote_type: "remote" });
    const auditRows = await db.all("SELECT field_name, applied FROM detail_refetch_changes WHERE run_id = ?;", [report.run_id]);
    assert.ok(auditRows.some((row) => row.field_name === "country" && row.applied === 1));
  } finally {
    await db.close();
  }
});

test("blocked detail response is reported without mutation", async () => {
  const dbPath = await createTestDb();
  const icimsRow = baseRow({ canonical_url: "https://fixtureco.icims.com/jobs/1001/support-engineer/job" });
  const existingRemoteRow = baseRow({ canonical_url: "https://fixtureco.icims.com/jobs/1002/existing-remote/job" });
  const report = await runDetailRefetch(
    {
      sources: ["icims"],
      limit: 4,
      companyLimit: 4,
      sample: 4,
      delayMs: 0,
      jitterMs: 0,
      detailByUrl: {
        [detailUrlForRow(icimsRow)]: readFixture("icims-detail-geo.html"),
        [detailUrlForRow(existingRemoteRow)]: readFixture("icims-detail-remote.html")
      }
    },
    { OPENJOBSLOTS_DB_BACKEND: "sqlite", DB_PATH: dbPath }
  );
  assert.ok(report.errors.some((item) => item.error === "blocked_detail_url"));
});

test("guarded apply records failed URLs and later runs skip them", async () => {
  const dbPath = await createTestDb();
  const icimsRow = baseRow({ canonical_url: "https://fixtureco.icims.com/jobs/1001/support-engineer/job" });
  const existingRemoteRow = baseRow({ canonical_url: "https://fixtureco.icims.com/jobs/1002/existing-remote/job" });
  const detailByUrl = {
    [detailUrlForRow(icimsRow)]: readFixture("icims-detail-geo.html"),
    [detailUrlForRow(existingRemoteRow)]: readFixture("icims-detail-remote.html")
  };
  const first = await runDetailRefetch(
    {
      sources: ["icims"],
      limit: 4,
      companyLimit: 4,
      delayMs: 0,
      jitterMs: 0,
      detailByUrl,
      apply: true,
      confirmProduction: true,
      backupConfirmed: true,
      maxUpdates: 2,
      batchSize: 1
    },
    { OPENJOBSLOTS_DB_BACKEND: "sqlite", DB_PATH: dbPath }
  );
  assert.ok(first.errors.some((item) => item.error === "blocked_detail_url"));

  const second = await runDetailRefetch(
    { sources: ["icims"], limit: 4, companyLimit: 4, delayMs: 0, jitterMs: 0, detailByUrl: {} },
    { OPENJOBSLOTS_DB_BACKEND: "sqlite", DB_PATH: dbPath }
  );
  assert.equal(second.skipped_previously_failed, 1);
  assert.ok(!second.candidate_summary.samples.some((item) => item.canonical_url === "https://example.test/jobs/404"));
});

test("new ATS sources (Greenhouse, Lever, Ashby, BambooHR, Gem, Workday, Oracle) build detail URLs and allow list checks", () => {
  const ghRow = baseRow({ ats_key: "greenhouse", canonical_url: "https://boards.greenhouse.io/company/jobs/12345" });
  assert.equal(detailUrlForRow(ghRow), "https://boards.greenhouse.io/company/jobs/12345");
  assert.ok(isAllowedDetailUrl("greenhouse", "https://boards.greenhouse.io/company/jobs/12345"));

  const leverRow = baseRow({ ats_key: "lever", canonical_url: "https://jobs.lever.co/company/abc-123" });
  assert.equal(detailUrlForRow(leverRow), "https://jobs.lever.co/company/abc-123");
  assert.ok(isAllowedDetailUrl("lever", "https://jobs.lever.co/company/abc-123"));

  const ashbyRow = baseRow({ ats_key: "ashby", canonical_url: "https://jobs.ashbyhq.com/company/abc-123" });
  assert.equal(detailUrlForRow(ashbyRow), "https://jobs.ashbyhq.com/company/abc-123");
  assert.ok(isAllowedDetailUrl("ashby", "https://jobs.ashbyhq.com/company/abc-123"));

  const bambooRow = baseRow({ ats_key: "bamboohr", canonical_url: "https://company.bamboohr.com/careers/123" });
  assert.equal(detailUrlForRow(bambooRow), "https://company.bamboohr.com/careers/123");
  assert.ok(isAllowedDetailUrl("bamboohr", "https://company.bamboohr.com/careers/123"));

  const gemRow = baseRow({ ats_key: "gem", canonical_url: "https://jobs.gem.com/company/123" });
  assert.equal(detailUrlForRow(gemRow), "https://jobs.gem.com/company/123");
  assert.ok(isAllowedDetailUrl("gem", "https://jobs.gem.com/company/123"));

  const workdayRow = baseRow({ ats_key: "workday", canonical_url: "https://company.myworkdayjobs.com/Careers/job/City/Title_JR1" });
  assert.equal(detailUrlForRow(workdayRow), "https://company.myworkdayjobs.com/Careers/job/City/Title_JR1");
  assert.ok(isAllowedDetailUrl("workday", "https://company.myworkdayjobs.com/Careers/job/City/Title_JR1"));

  const oracleRow = baseRow({ ats_key: "oracle", canonical_url: "https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/jobsearch/job/334912" });
  assert.equal(detailUrlForRow(oracleRow), "https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/jobsearch/job/334912");
  assert.ok(isAllowedDetailUrl("oracle", "https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/jobsearch/job/334912"));
});

test("extractDetailFields parses json-ld for new ATS sources", () => {
  const row = baseRow({ ats_key: "greenhouse", canonical_url: "https://boards.greenhouse.io/company/jobs/12345" });
  const html = `
    <html>
    <body>
      <script type="application/ld+json">
      {
        "@type": "JobPosting",
        "jobLocation": {
          "address": {
            "addressLocality": "Berlin",
            "addressCountry": "Germany"
          }
        },
        "description": "This is a fully remote position (work from home)."
      }
      </script>
    </body>
    </html>
  `;
  const detail = extractDetailFields(row, html);
  assert.equal(detail.location, "Berlin, Germany");
  assert.equal(detail.remote_type, "remote");
});

