const test = require("node:test");
const assert = require("node:assert/strict");
const { parseArgs } = require("./audit-source-freshness");
const {
  createSourceFreshnessReportFromRows,
  cutoffEpochForDays
} = require("../server/ingestion/dataQualityAudit");

test("parseArgs accepts source freshness window and output controls", () => {
  const options = parseArgs(["--json", "--days=30", "--limit", "5", "--output=C:\\tmp\\fresh.json"]);
  assert.equal(options.json, true);
  assert.equal(options.days, 30);
  assert.equal(options.limit, 5);
  assert.equal(options.output, "C:\\tmp\\fresh.json");
});

test("source freshness report marks stale sources due without mutating data", () => {
  const nowEpoch = 1_800_000_000;
  const cutoff = cutoffEpochForDays(30, nowEpoch);
  const report = createSourceFreshnessReportFromRows(
    [
      {
        ats_key: "greenhouse",
        canonical_url: "https://boards.greenhouse.io/acme/jobs/1",
        parser_version: "greenhouse-v1",
        location_text: "New York, NY",
        country: "United States",
        region: "North America",
        city: "New York",
        remote_type: "onsite",
        quality_score: 100,
        last_seen_epoch: cutoff + 100
      },
      {
        ats_key: "applytojob",
        canonical_url: "https://acme.applytojob.com/apply/1",
        parser_version: "applytojob-v1",
        location_text: "",
        country: "",
        region: "",
        city: "",
        remote_type: "unknown",
        quality_score: 50,
        last_seen_epoch: cutoff - 100
      }
    ],
    { staleDays: 30, nowEpoch }
  );

  assert.equal(report.filters.stale_days, 30);
  assert.equal(report.items[0].ats_key, "applytojob");
  assert.equal(report.items[0].is_due, true);
  assert.equal(report.items[0].due_reason, "posting_stale");
  assert.equal(report.items.find((item) => item.ats_key === "greenhouse").is_due, false);
});
