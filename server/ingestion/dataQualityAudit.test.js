const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3");
const {
  aggregateRows,
  classifyStoredPosting
} = require("./dataQualityAudit");
const { runAudit } = require("../../scripts/audit-data-quality");

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

test("quality audit derives field gaps from stored fields when quality_flags are empty", () => {
  const report = aggregateRows([
    {
      ats_key: "icims",
      parser_version: "icims-v1",
      location_text: "",
      country: "",
      region: "",
      city: "",
      remote_type: "unknown",
      quality_score: 100,
      quality_flags: "[]"
    },
    {
      ats_key: "lever",
      parser_version: "lever-v1",
      location_text: "Istanbul, Turkey",
      country: "Turkey",
      region: "EMEA",
      city: "Istanbul",
      remote_type: "remote",
      quality_score: 100,
      quality_flags: "[]"
    }
  ]);

  assert.equal(report.summary.total_visible_postings, 2);
  assert.equal(report.summary.missing_country_count, 1);
  assert.equal(report.summary.missing_location_text_count, 1);
  assert.equal(report.summary.missing_any_normalized_geo_count, 1);
  assert.equal(report.summary.weak_unknown_remote_type_count, 1);
  assert.equal(report.by_source.find((row) => row.source_ats === "icims").missing_all_geo_and_weak_remote_count, 1);
});

test("quality audit groups parser stats by ATS and parser version", () => {
  const report = aggregateRows([
    {
      ats_key: "applytojob",
      parser_version: "applytojob-v1",
      location_text: "Remote",
      country: "",
      region: "",
      city: "",
      remote_type: "remote",
      quality_score: 0,
      quality_flags: JSON.stringify(["missing_country"])
    },
    {
      ats_key: "applytojob",
      parser_version: "applytojob-v2",
      location_text: "Berlin, Germany",
      country: "Germany",
      region: "EMEA",
      city: "Berlin",
      remote_type: "hybrid",
      quality_score: 100,
      quality_flags: "[]"
    }
  ]);

  const v1 = report.by_parser.find((row) => row.source_ats === "applytojob" && row.parser_version === "applytojob-v1");
  const v2 = report.by_parser.find((row) => row.source_ats === "applytojob" && row.parser_version === "applytojob-v2");
  assert.equal(v1.total_visible_rows, 1);
  assert.equal(v1.missing_any_normalized_geo_count, 1);
  assert.equal(v1.quality_flag_counts.missing_country, 1);
  assert.equal(v2.total_visible_rows, 1);
  assert.equal(v2.missing_any_normalized_geo_count, 0);
});

test("stored-field classifier handles null, empty, unknown, n/a, remote, and multiple locations", () => {
  assert.equal(classifyStoredPosting({ country: null }).missing_country, true);
  assert.equal(classifyStoredPosting({ country: "" }).missing_country, true);
  assert.equal(classifyStoredPosting({ country: "unknown" }).missing_country, true);
  assert.equal(classifyStoredPosting({ country: "n/a" }).missing_country, true);
  assert.equal(classifyStoredPosting({ location_text: "" }).suspicious_unknown_geo, false);
  assert.equal(classifyStoredPosting({ location_text: "remote" }).suspicious_unknown_geo, true);
  assert.equal(classifyStoredPosting({ location_text: "multiple locations" }).suspicious_unknown_geo, true);
  assert.equal(classifyStoredPosting({ remote_type: "" }).missing_remote_type, true);
  assert.equal(classifyStoredPosting({ remote_type: "remote" }).weak_unknown_remote_type, false);
});

test("audit command reads SQLite in read-only mode and does not mutate rows", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openjobslots-audit-test-"));
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
        location_text, country, region, city, remote_type, quality_score, quality_flags, hidden
      ) VALUES (
        'Example', 'Support Engineer', 'https://example.test/jobs/1', 'careerplug', 'careerplug-v1',
        '', '', '', '', 'unknown', 100, '[]', 0
      );
    `);
    const before = await db.all("SELECT COUNT(*) AS count FROM Postings;");
    assert.equal(Number(before[0].count), 1);
  } finally {
    await db.close();
  }

  const report = await runAudit(
    { json: true, bySource: true, byParser: true, limit: 10, dbPath },
    { OPENJOBSLOTS_DB_BACKEND: "sqlite", DB_PATH: dbPath }
  );
  assert.equal(report.ok, true);
  assert.equal(report.summary.total_visible_postings, 1);
  assert.equal(report.summary.missing_all_geo_and_weak_remote_count, 1);

  const verifyDb = await openWritableSqlite(dbPath);
  try {
    const after = await verifyDb.all("SELECT COUNT(*) AS count FROM Postings;");
    assert.equal(Number(after[0].count), 1);
  } finally {
    await verifyDb.close();
  }
});
