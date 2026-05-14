const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyGrowthPosting,
  normalizeHours,
  summarizeGrowthRows
} = require("./growthSummary");

test("growth classifier marks geo-backed and explicit-remote rows as clean", () => {
  const geoBacked = classifyGrowthPosting({
    canonical_url: "https://example.test/jobs/1",
    position_name: "Support Engineer",
    company_name: "Example",
    ats_key: "greenhouse",
    source_job_id: "job-1",
    city: "Istanbul",
    region: "EMEA",
    country: "Turkey",
    remote_type: "unknown"
  });
  assert.equal(geoBacked.clean_public_row, true);
  assert.equal(geoBacked.no_geo_no_remote, false);

  const remoteBacked = classifyGrowthPosting({
    canonical_url: "https://example.test/jobs/2",
    position_name: "Remote Engineer",
    company_name: "Example",
    ats_key: "lever",
    source_job_id: "job-2",
    city: "",
    region: "",
    country: "",
    remote_type: "remote"
  });
  assert.equal(remoteBacked.clean_public_row, true);
  assert.equal(remoteBacked.missing_any_normalized_geo, true);
  assert.equal(remoteBacked.no_geo_no_remote, false);
});

test("growth classifier rejects no_geo_no_remote public rows", () => {
  const dirty = classifyGrowthPosting({
    canonical_url: "https://example.test/jobs/3",
    position_name: "Analyst",
    company_name: "Example",
    ats_key: "icims",
    source_job_id: "job-3",
    city: "",
    region: "",
    country: "",
    remote_type: "unknown"
  });
  assert.equal(dirty.clean_public_row, false);
  assert.equal(dirty.no_geo_no_remote, true);
});

test("growth summary aggregates clean rows, dirty public rows, quarantine rows, and failed source runs", () => {
  const report = summarizeGrowthRows(
    {
      currentVisibleRows: 100,
      currentIndexableRows: 98,
      publicRows: [
        {
          canonical_url: "https://example.test/jobs/1",
          position_name: "Support Engineer",
          company_name: "Example",
          ats_key: "greenhouse",
          source_job_id: "job-1",
          city: "Istanbul",
          region: "EMEA",
          country: "Turkey",
          remote_type: "unknown"
        },
        {
          canonical_url: "https://example.test/jobs/2",
          position_name: "Remote Engineer",
          company_name: "Example",
          ats_key: "lever",
          source_job_id: "job-2",
          city: "",
          region: "",
          country: "",
          remote_type: "remote"
        },
        {
          canonical_url: "https://example.test/jobs/3",
          position_name: "Analyst",
          company_name: "Example",
          ats_key: "icims",
          source_job_id: "job-3",
          city: "",
          region: "",
          country: "",
          remote_type: "unknown"
        }
      ],
      cacheRows: [
        { ats_key: "zoho", validation_status: "quarantined" },
        { ats_key: "taleo", validation_status: "invalid" }
      ],
      sourceRuns: [
        { ats_key: "greenhouse", status: "completed" },
        { ats_key: "lever", status: "completed_with_errors" },
        { ats_key: "icims", status: "failed" }
      ],
      meiliOutboxRows: [
        { operation: "upsert", processed_at: "2026-05-14T00:00:00.000Z" },
        { operation: "delete", processed_at: "2026-05-14T00:00:00.000Z" }
      ]
    },
    { hours: 24, nowEpoch: 1778716800, cutoffEpoch: 1778630400 }
  );

  assert.equal(report.current_visible_rows, 100);
  assert.equal(report.current_indexable_rows, 98);
  assert.equal(report.metrics.new_visible_rows, 3);
  assert.equal(report.metrics.new_indexable_rows, 3);
  assert.equal(report.metrics.new_clean_rows, 2);
  assert.equal(report.metrics.dirty_public_rows, 1);
  assert.equal(report.metrics.new_rows_missing_any_geo, 2);
  assert.equal(report.metrics.new_rows_weak_unknown_remote, 2);
  assert.equal(report.metrics.new_no_geo_no_remote, 1);
  assert.equal(report.metrics.new_quarantine_rows, 1);
  assert.equal(report.metrics.new_rejected_rows, 1);
  assert.equal(report.metrics.meili_indexed_rows_added, 3);
  assert.equal(report.metrics.meili_outbox_upserts_processed, 1);
  assert.equal(report.metrics.worker_source_runs, 3);
  assert.equal(report.metrics.failed_source_runs, 2);
  assert.equal(report.new_clean_rows_24h, 2);
  assert.equal(report.new_no_geo_no_remote_24h, 1);
  assert.equal(report.meili_indexed_rows_added_24h, 3);
  assert.equal(report.worker_source_runs_24h, 3);
});

test("clean acceptance rate includes public, quarantine, and rejected new rows by ATS", () => {
  const report = summarizeGrowthRows(
    {
      publicRows: [
        {
          canonical_url: "https://example.test/jobs/1",
          position_name: "Support Engineer",
          company_name: "Example",
          ats_key: "greenhouse",
          source_job_id: "job-1",
          city: "Istanbul",
          region: "EMEA",
          country: "Turkey",
          remote_type: "unknown"
        }
      ],
      cacheRows: [
        { ats_key: "greenhouse", validation_status: "quarantined" },
        { ats_key: "greenhouse", validation_status: "invalid" }
      ]
    },
    { hours: 24, nowEpoch: 1778716800, cutoffEpoch: 1778630400 }
  );

  const greenhouse = report.clean_acceptance_rate_by_ats_24h.find((row) => row.ats_key === "greenhouse");
  assert.equal(greenhouse.new_clean_rows, 1);
  assert.equal(greenhouse.new_quarantine_rows, 1);
  assert.equal(greenhouse.new_rejected_rows, 1);
  assert.equal(greenhouse.clean_acceptance_rate_pct, 33.33);
});

test("hours are bounded for expensive growth windows", () => {
  assert.equal(normalizeHours("0"), 24);
  assert.equal(normalizeHours("168"), 168);
  assert.equal(normalizeHours(String(24 * 365)), 24 * 90);
});
