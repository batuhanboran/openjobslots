const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildQualityMetadata,
  buildStoredQualityFields,
  getQualityFlags,
  scorePostingQuality
} = require("./dataQuality");

test("accepted posting quality metadata is bounded and source-explainable", () => {
  const metadata = buildQualityMetadata(
    {
      canonical_url: "https://example.test/jobs/123",
      source_job_id: "123",
      ats_key: "greenhouse",
      company_name: "Example",
      position_name: "QA Engineer",
      location_text: "Istanbul, Turkey",
      country: "Turkey",
      region: "EMEA",
      city: "Istanbul",
      remote_type: "hybrid",
      posting_date: "2026-05-08",
      posted_at_epoch: 1778198400,
      first_seen_epoch: 1778198400,
      last_seen_epoch: 1778198400,
      parser_version: "greenhouse-v1",
      confidence: 0.9,
      raw_payload_hash: "hash"
    },
    { nowEpoch: 1778198400 }
  );

  assert.equal(metadata.quality_score, 100);
  assert.deepEqual(metadata.quality_flags, []);
  assert.equal(metadata.source_ats, "greenhouse");
  assert.equal(metadata.parser_version, "greenhouse-v1");
  assert.equal(metadata.confidence_score, 0.9);
  assert.equal(metadata.cache_state, "cached");
  assert.equal(metadata.normalized_location.country, "Turkey");
});

test("quality flags detect rejected and incomplete postings", () => {
  const flags = getQualityFlags(
    {
      ats_key: "careerplug",
      company_name: "",
      position_name: "",
      canonical_url: "",
      validation_status: "invalid",
      validation_error: "missing title"
    },
    { nowEpoch: 1778198400 }
  );

  assert.ok(flags.includes("missing_title"));
  assert.ok(flags.includes("missing_company"));
  assert.ok(flags.includes("missing_url"));
  assert.ok(flags.includes("rejected"));
  assert.equal(scorePostingQuality(flags), 0);
});

test("stored quality fields serialize stable flags", () => {
  const stored = buildStoredQualityFields(
    {
      canonical_url: "https://example.test/jobs/456",
      company_name: "Example",
      position_name: "Remote Support",
      ats_key: "lever",
      remote_type: "unknown",
      parser_version: "lever-v1",
      confidence: 0.4
    },
    { nowEpoch: 1778198400 }
  );

  assert.equal(typeof stored.quality_score, "number");
  assert.ok(stored.quality_score < 100);
  assert.deepEqual(JSON.parse(stored.quality_flags), [
    "missing_country",
    "missing_location_text",
    "missing_posted_at",
    "missing_region",
    "missing_source_job_id",
    "parser_confidence_low",
    "weak_remote_classification"
  ]);
});

test("quality metadata exposes quarantined cache state", () => {
  const metadata = buildQualityMetadata(
    {
      canonical_url: "https://example.test/jobs/quarantine",
      company_name: "Example",
      position_name: "Support Engineer",
      ats_key: "fixture",
      validation_status: "quarantined",
      validation_error: "no_geo_unknown_remote",
      remote_type: "unknown",
      parser_version: "fixture-v1",
      confidence: 0.7
    },
    { nowEpoch: 1778198400 }
  );

  assert.equal(metadata.cache_state, "quarantined");
  assert.ok(metadata.quality_flags.includes("quarantined"));
  assert.ok(metadata.quality_flags.includes("rejected"));
  assert.equal(metadata.rejection_reason, "no_geo_unknown_remote");
  assert.ok(metadata.quality_score < 100);
});
