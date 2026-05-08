const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3");
const {
  classifyBackfillCandidate,
  parseDelimitedLocation,
  runDryRun,
  summarizePlan
} = require("./geoRemotePlanner");

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
  const planned = classifyBackfillCandidate(baseRow({ location_text: "Istanbul, Türkiye" }));
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
