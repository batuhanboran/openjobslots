const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildEvidenceMetadata,
  evaluatePublicPosting,
  hasUsefulGeoEvidence,
  normalizeRemoteType
} = require("./publicPostingGate");

function basePosting(overrides = {}) {
  return {
    ats_key: "fixture",
    parser_version: "fixture-v1",
    parser_confidence: 0.8,
    source_job_id: "job-1",
    company_name: "Fixture Co",
    position_name: "Support Engineer",
    canonical_url: "https://example.com/jobs/1",
    job_posting_url: "https://example.com/jobs/1",
    posting_date: "2026-05-08",
    ...overrides
  };
}

test("public posting gate accepts a good row with deterministic geo evidence", () => {
  const result = evaluatePublicPosting(basePosting({
    location_text: "Istanbul, Turkey",
    country: "Turkey",
    region: "Istanbul",
    city: "Istanbul",
    remote_type: "onsite"
  }));

  assert.equal(result.status, "accepted");
  assert.equal(result.public, true);
  assert.equal(result.evidence.country.present, true);
  assert.equal(result.evidence.city.present, true);
});

test("public posting gate quarantines rows with missing geo and unknown remote", () => {
  const result = evaluatePublicPosting(basePosting({
    location_text: "",
    country: "",
    region: "",
    city: "",
    remote_type: "unknown"
  }));

  assert.equal(result.status, "quarantined");
  assert.ok(result.reason_codes.includes("no_geo_unknown_remote"));
  assert.equal(result.retry_detail_refetch_eligible, true);
});

test("public posting gate quarantines ambiguous country-code-only locations", () => {
  const result = evaluatePublicPosting(basePosting({
    location_text: "IN",
    country: "",
    region: "",
    city: "",
    remote_type: "unknown"
  }));

  assert.equal(result.status, "quarantined");
  assert.ok(result.reason_codes.includes("ambiguous_geo"));
});

test("public posting gate accepts explicit remote and hybrid rows without geo", () => {
  const remote = evaluatePublicPosting(basePosting({
    position_name: "Remote Support Engineer",
    location_text: "Remote",
    remote_type: "remote"
  }));
  const hybrid = evaluatePublicPosting(basePosting({
    position_name: "Hybrid Support Engineer",
    location_text: "Hybrid - London",
    remote_type: "hybrid"
  }));

  assert.equal(remote.status, "accepted");
  assert.equal(hybrid.status, "accepted");
});

test("public posting gate does not accept vague remote marketing text as explicit remote", () => {
  const result = evaluatePublicPosting(basePosting({
    description_plain: "Our teams support flexible work arrangements.",
    location_text: "",
    country: "",
    region: "",
    city: "",
    remote_type: "unknown"
  }));

  assert.equal(result.status, "quarantined");
  assert.ok(result.reason_codes.includes("no_geo_unknown_remote"));
});

test("public posting gate preserves canonical and source id evidence", () => {
  const posting = basePosting({
    source_job_id: "",
    canonical_url: "https://example.com/jobs/stable",
    location_text: "Berlin, Germany",
    country: "Germany",
    remote_type: "unknown"
  });
  const evidence = buildEvidenceMetadata(posting);
  const result = evaluatePublicPosting(posting);

  assert.equal(evidence.canonical_url.value, "https://example.com/jobs/stable");
  assert.equal(evidence.source_job_id.present, false);
  assert.equal(result.status, "accepted");
  assert.ok(result.reason_codes.includes("missing_source_job_id"));
  assert.ok(result.confidence < posting.parser_confidence);
});

test("public posting gate rejects rows missing required identity fields", () => {
  assert.equal(evaluatePublicPosting(basePosting({ position_name: "" })).status, "rejected");
  assert.equal(evaluatePublicPosting(basePosting({ company_name: "" })).status, "rejected");
  assert.equal(evaluatePublicPosting(basePosting({ canonical_url: "", job_posting_url: "" })).status, "rejected");
});

test("public posting gate normalizes remote aliases and detects useful geo", () => {
  assert.equal(normalizeRemoteType("on-site"), "onsite");
  assert.equal(normalizeRemoteType("n/a"), "unknown");
  assert.equal(hasUsefulGeoEvidence({ location_text: "Remote" }), false);
  assert.equal(hasUsefulGeoEvidence({ location_text: "Istanbul, Turkey" }), true);
});
