const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3");
const {
  classifyBackfillCandidate,
  getSafetyGate,
  parseDelimitedLocation,
  runBackfill,
  runDryRun,
  runRollback,
  summarizePlan
} = require("./geoRemotePlanner");
const { aggregateRows } = require("../dataQualityAudit");

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
    canonical_url: "https://example.test/jobs/1",
    ats_key: "icims",
    parser_version: "test-parser-v1",
    company_name: "Example",
    position_name: "Support Engineer",
    location_text: "",
    country: "",
    region: "",
    city: "",
    remote_type: "unknown",
    quality_flags: "[]",
    raw_metadata: "{}",
    ...overrides
  };
}

test("planner proposes Turkish country, region, and Istanbul city from deterministic aliases", () => {
  const planned = classifyBackfillCandidate(baseRow({ location_text: "Istanbul, Turkiye" }));
  assert.ok(planned.classifications.includes("fixable_country"));
  assert.ok(planned.classifications.includes("fixable_region"));
  assert.ok(planned.classifications.includes("fixable_city"));
  assert.equal(planned.after.country, "Turkey");
  assert.equal(planned.after.region, "EMEA");
  assert.equal(planned.after.city, "Istanbul");
  assert.ok(planned.changes.every((change) => change.rule && Number(change.confidence) > 0));
});

test("planner protects IN and IL ambiguity unless country evidence is explicit", () => {
  assert.equal(parseDelimitedLocation("IN").unsafe, true);
  assert.equal(parseDelimitedLocation("IL").unsafe, true);
  assert.equal(parseDelimitedLocation("Chicago, IL").unsafe, true);

  const india = classifyBackfillCandidate(baseRow({ location_text: "IN-KL-Kozhikode" }));
  assert.equal(india.after.country, "India");
  assert.equal(india.after.city, "Kozhikode");

  const us = classifyBackfillCandidate(baseRow({ location_text: "Chicago, IL, United States" }));
  assert.equal(us.after.country, "United States");
  assert.equal(us.after.region, "Illinois");
  assert.equal(us.after.city, "Chicago");
});

test("planner handles remote and hybrid location patterns without inventing onsite", () => {
  const remote = classifyBackfillCandidate(baseRow({ location_text: "Remote - US" }));
  assert.equal(remote.after.country, "United States");
  assert.equal(remote.after.region, "North America");
  assert.equal(remote.after.remote_type, "remote");
  assert.ok(remote.classifications.includes("fixable_remote_type"));

  const hybrid = classifyBackfillCandidate(baseRow({ location_text: "Hybrid - London" }));
  assert.equal(hybrid.after.country, "United Kingdom");
  assert.equal(hybrid.after.city, "London");
  assert.equal(hybrid.after.remote_type, "hybrid");

  const onsiteWeak = classifyBackfillCandidate(baseRow({ location_text: "Austin, TX, United States" }));
  assert.equal(onsiteWeak.after.remote_type, "unknown");
  assert.ok(!onsiteWeak.classifications.includes("fixable_remote_type"));
});

test("planner marks multi-location evidence unsafe instead of inventing a country or city", () => {
  const planned = classifyBackfillCandidate(baseRow({ location_text: "London / New York" }));
  assert.ok(planned.classifications.includes("unsafe_ambiguous"));
  assert.equal(planned.after.country, "");
  assert.equal(planned.after.city, "");
});

test("planner keeps weak remote evidence unknown", () => {
  const planned = classifyBackfillCandidate(
    baseRow({
      position_name: "Remote Support Engineer",
      raw_metadata: JSON.stringify({ description: "We support remote collaboration tools." })
    })
  );
  assert.equal(planned.after.remote_type, "unknown");
  assert.ok(!planned.changes.some((change) => change.field === "remote_type"));
});

test("planner summarizes refetch and unsafe categories with bounded samples", () => {
  const report = summarizePlan([
    baseRow({ ats_key: "icims", location_text: "", country: "", region: "", city: "" }),
    baseRow({ ats_key: "applitrack", canonical_url: "https://example.test/jobs/2", location_text: "", country: "", region: "", city: "" }),
    baseRow({ ats_key: "lever", canonical_url: "https://example.test/jobs/3", location_text: "London / New York" })
  ], { sample: 2 });

  assert.equal(report.total_scanned, 3);
  assert.equal(report.rows_requiring_icims_detail_refetch, 1);
  assert.equal(report.rows_requiring_applitrack_detail_refetch, 1);
  assert.equal(report.unsafe_ambiguous_rows, 1);
  assert.equal(report.icims_detail_refetch_rows.length, 1);
  assert.equal(report.applitrack_detail_refetch_rows.length, 1);
  assert.equal(report.unsafe_ambiguous_samples.length, 1);
});

test("dry-run command does not mutate SQLite rows", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openjobslots-geo-remote-test-"));
  const dbPath = path.join(tempDir, "jobs.db");
  const db = await openWritableSqlite(dbPath);
  try {
    await db.exec(`
      CREATE TABLE Postings (
        company_name TEXT,
        position_name TEXT,
        job_posting_url TEXT,
        ats_key TEXT,
        parser_version TEXT,
        location_text TEXT,
        location TEXT,
        country TEXT,
        region TEXT,
        city TEXT,
        remote_type TEXT,
        quality_score INTEGER NOT NULL DEFAULT 0,
        quality_flags TEXT,
        hidden INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO Postings (
        company_name, position_name, job_posting_url, ats_key, parser_version,
        location_text, location, country, region, city, remote_type, quality_flags, hidden
      ) VALUES (
        'Example', 'Support Engineer', 'https://example.test/jobs/1', 'careerplug', 'careerplug-v1',
        'Istanbul, Turkiye', 'Istanbul, Turkiye', '', '', '', 'unknown', '[]', 0
      );
    `);
    const before = await db.all("SELECT country, region, city, remote_type FROM Postings;");
    assert.deepEqual(before[0], { country: "", region: "", city: "", remote_type: "unknown" });
  } finally {
    await db.close();
  }

  const report = await runDryRun(
    { limit: 10, source: "careerplug", json: true, sample: 5, output: "", noProductionWrite: true },
    { OPENJOBSLOTS_DB_BACKEND: "sqlite", DB_PATH: dbPath }
  );
  assert.equal(report.ok, true);
  assert.equal(report.dry_run, true);
  assert.equal(report.total_scanned, 1);
  assert.equal(report.classification_counts.fixable_country, 1);

  const verifyDb = await openWritableSqlite(dbPath);
  try {
    const after = await verifyDb.all("SELECT country, region, city, remote_type FROM Postings;");
    assert.deepEqual(after[0], { country: "", region: "", city: "", remote_type: "unknown" });
  } finally {
    await verifyDb.close();
  }
});

test("apply mode requires all explicit safety flags", () => {
  assert.equal(getSafetyGate({ apply: true, confirmProduction: true, backupConfirmed: true, maxUpdates: 0 }).authorized, false);
  assert.equal(getSafetyGate({ apply: true, confirmProduction: true, backupConfirmed: false, maxUpdates: 1 }).authorized, false);
  assert.equal(getSafetyGate({ apply: true, confirmProduction: true, backupConfirmed: true, maxUpdates: 1 }).authorized, true);
});

test("guarded apply mutates only safe rows, writes audit trail, and rollback restores fields", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openjobslots-geo-remote-apply-test-"));
  const dbPath = path.join(tempDir, "jobs.db");
  const db = await openWritableSqlite(dbPath);
  try {
    await db.exec(`
      CREATE TABLE Postings (
        company_name TEXT,
        position_name TEXT,
        job_posting_url TEXT,
        ats_key TEXT,
        parser_version TEXT,
        location_text TEXT,
        location TEXT,
        country TEXT,
        region TEXT,
        city TEXT,
        remote_type TEXT,
        quality_score INTEGER NOT NULL DEFAULT 0,
        quality_flags TEXT NOT NULL DEFAULT '[]',
        hidden INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO Postings (
        company_name, position_name, job_posting_url, ats_key, parser_version,
        location_text, location, country, region, city, remote_type, quality_score, quality_flags, hidden
      ) VALUES
      (
        'Example', 'Support Engineer', 'https://example.test/jobs/safe', 'careerplug', 'careerplug-v1',
        'Istanbul, Turkiye', 'Istanbul, Turkiye', '', '', '', 'unknown', 0, '[]', 0
      ),
      (
        'Example', 'Remote Support Engineer', 'https://example.test/jobs/weak-remote', 'careerplug', 'careerplug-v1',
        '', '', '', '', '', 'unknown', 0, '[]', 0
      ),
      (
        'Example', 'Sales Engineer', 'https://example.test/jobs/unsafe', 'careerplug', 'careerplug-v1',
        'London / New York', 'London / New York', '', '', '', 'unknown', 0, '[]', 0
      ),
      (
        'Example', 'Existing Remote', 'https://example.test/jobs/no-downgrade', 'careerplug', 'careerplug-v1',
        'Hybrid - London', 'Hybrid - London', 'United Kingdom', 'EMEA', 'London', 'remote', 100, '[]', 0
      );
    `);

    const beforeRows = await db.all("SELECT * FROM Postings ORDER BY job_posting_url;");
    const beforeSummary = aggregateRows(beforeRows).summary;
    assert.equal(beforeSummary.missing_country_count, 3);
  } finally {
    await db.close();
  }

  const dryReport = await runBackfill(
    { limit: 10, source: "careerplug", json: true, sample: 5, output: "", apply: true, confirmProduction: true, backupConfirmed: false, maxUpdates: 10, batchSize: 2 },
    { OPENJOBSLOTS_DB_BACKEND: "sqlite", DB_PATH: dbPath }
  );
  assert.equal(dryReport.dry_run, true);
  assert.equal(dryReport.apply_mode, false);

  const applyReport = await runBackfill(
    {
      limit: 10,
      source: "careerplug",
      json: true,
      sample: 5,
      output: "",
      apply: true,
      confirmProduction: true,
      backupConfirmed: true,
      maxUpdates: 10,
      batchSize: 2,
      operator: "test"
    },
    { OPENJOBSLOTS_DB_BACKEND: "sqlite", DB_PATH: dbPath }
  );
  assert.equal(applyReport.apply_mode, true);
  assert.equal(applyReport.applied_rows, 2);
  assert.ok(applyReport.applied_changes >= 4);
  assert.ok(applyReport.run_id);

  const verifyDb = await openWritableSqlite(dbPath);
  try {
    const rows = await verifyDb.all("SELECT * FROM Postings ORDER BY job_posting_url;");
    const safe = rows.find((row) => row.job_posting_url.endsWith("/safe"));
    const weak = rows.find((row) => row.job_posting_url.endsWith("/weak-remote"));
    const unsafe = rows.find((row) => row.job_posting_url.endsWith("/unsafe"));
    const noDowngrade = rows.find((row) => row.job_posting_url.endsWith("/no-downgrade"));
    assert.equal(safe.country, "Turkey");
    assert.equal(safe.region, "EMEA");
    assert.equal(safe.city, "Istanbul");
    assert.equal(safe.remote_type, "unknown");
    assert.equal(weak.remote_type, "unknown");
    assert.equal(unsafe.country, "");
    assert.equal(noDowngrade.remote_type, "remote");
    const auditRows = await verifyDb.all("SELECT * FROM data_quality_backfill_changes WHERE run_id = ?;", [applyReport.run_id]);
    assert.ok(auditRows.length >= 4);
    assert.ok(auditRows.every((row) => row.rule_name && row.reversible_metadata));
    const afterSummary = aggregateRows(rows).summary;
    assert.ok(afterSummary.missing_country_count < aggregateRows([
      { ats_key: "careerplug", parser_version: "careerplug-v1", location_text: "Istanbul, Turkiye", country: "", region: "", city: "", remote_type: "unknown", quality_flags: "[]" },
      { ats_key: "careerplug", parser_version: "careerplug-v1", location_text: "", country: "", region: "", city: "", remote_type: "unknown", quality_flags: "[]" },
      { ats_key: "careerplug", parser_version: "careerplug-v1", location_text: "London / New York", country: "", region: "", city: "", remote_type: "unknown", quality_flags: "[]" },
      { ats_key: "careerplug", parser_version: "careerplug-v1", location_text: "Hybrid - London", country: "United Kingdom", region: "EMEA", city: "London", remote_type: "remote", quality_flags: "[]" }
    ]).summary.missing_country_count);
  } finally {
    await verifyDb.close();
  }

  const rollbackReport = await runRollback(
    { rollbackRunId: applyReport.run_id, batchSize: 2, json: true, operator: "test" },
    { OPENJOBSLOTS_DB_BACKEND: "sqlite", DB_PATH: dbPath }
  );
  assert.equal(rollbackReport.ok, true);
  assert.ok(rollbackReport.restored_changes >= 4);

  const rollbackDb = await openWritableSqlite(dbPath);
  try {
    const safe = (await rollbackDb.all("SELECT country, region, city, remote_type FROM Postings WHERE job_posting_url = 'https://example.test/jobs/safe';"))[0];
    assert.deepEqual(safe, { country: "", region: "", city: "", remote_type: "unknown" });
    const run = (await rollbackDb.all("SELECT status, rollback_metadata FROM data_quality_backfill_runs WHERE run_id = ?;", [applyReport.run_id]))[0];
    assert.equal(run.status, "rolled_back");
    assert.ok(run.rollback_metadata.includes("restored_changes"));
  } finally {
    await rollbackDb.close();
  }
});
