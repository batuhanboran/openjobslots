const assert = require("assert");

const { createPublicSerializers } = require("./publicSerializers");

function createSerializers() {
  return createPublicSerializers({
    inferAtsFromJobPostingUrl: () => "greenhouse",
    normalizeAtsFilterValue: (value) => String(value || "").trim().toLowerCase(),
    nowEpochSeconds: () => 1000,
    sanitizeFrontendText: (value, fallback = "") => String(value || fallback || "").replace(/\0/g, ""),
    atsFilterLabelByValue: new Map([["greenhouse", "Greenhouse"]]),
    sourceFacetFreshDays: 0.001,
    sourceFacetLimit: 8
  });
}

function testPublicPostingSerializerRemovesPrivateFields() {
  const { sanitizePublicPostingItem } = createSerializers();
  const item = sanitizePublicPostingItem({
    id: "42",
    company_name: "Example Inc",
    position_name: "Engineer",
    job_posting_url: "https://example.com/jobs/42",
    location: "Remote",
    posting_date: "2026-05-24",
    last_seen_epoch: "999",
    ats: "greenhouse",
    raw_payload_hash: "private",
    parser_payload: { private: true }
  });

  assert.deepEqual(item, {
    id: 42,
    company_name: "Example Inc",
    position_name: "Engineer",
    job_posting_url: "https://example.com/jobs/42",
    location: "Remote",
    posting_date: "2026-05-24",
    last_seen_epoch: 999,
    ats: "greenhouse"
  });
}

function testSourceFacetsArePublicAndBounded() {
  const { buildPublicSourceFacets } = createSerializers();
  const facets = buildPublicSourceFacets([
    {
      ats: "greenhouse",
      job_posting_url: "https://example.com/jobs/1",
      confidence: 0.9,
      quality_score: 88,
      last_seen_epoch: 999
    },
    {
      ats: "greenhouse",
      job_posting_url: "https://example.com/jobs/2",
      confidence: 0.7,
      quality_score: 90,
      last_seen_epoch: 800
    }
  ]);

  assert.deepEqual(facets, [
    {
      value: "greenhouse",
      label: "Greenhouse",
      count: 2,
      avg_confidence: 0.8,
      avg_quality: 89,
      latest_seen_epoch: 999,
      fresh_count: 1,
      fresh_percentage: 50
    }
  ]);
}

testPublicPostingSerializerRemovesPrivateFields();
testSourceFacetsArePublicAndBounded();

console.log("public serializer tests passed");
