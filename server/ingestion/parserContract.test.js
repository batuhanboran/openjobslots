const test = require("node:test");
const assert = require("node:assert/strict");
const {
  NORMALIZED_POSTING_FIELDS,
  PARSER_CONTRACT_VERSION,
  confidenceScore,
  validateNormalizedPostingContract
} = require("./parserContract");
const { normalizePosting } = require("./posting");

test("parser contract lists required normalized fields", () => {
  assert.equal(PARSER_CONTRACT_VERSION, "parser-contract-v1");
  for (const field of [
    "source_job_id",
    "ats_key",
    "company",
    "title",
    "canonical_url",
    "apply_url",
    "posted_at_epoch",
    "parser_version",
    "parser_confidence"
  ]) {
    assert.ok(NORMALIZED_POSTING_FIELDS.includes(field), `${field} should be part of contract`);
  }
});

test("parser contract validates required public fields and parser metadata", () => {
  const normalized = normalizePosting(
    {
      company_name: "Fixture",
      position_name: "Support Engineer",
      job_posting_url: "https://example.com/jobs/support",
      posting_date: "2026-05-08"
    },
    {},
    "greenhouse",
    {
      parserVersion: "fixture-parser-v1",
      confidence: 0.75
    }
  );
  assert.deepEqual(validateNormalizedPostingContract(normalized), { ok: true, error: "" });

  assert.equal(
    validateNormalizedPostingContract({
      ...normalized,
      parser_confidence: undefined
    }).error,
    "missing parser_confidence"
  );
});

test("confidence levels are normalized for adapter metadata", () => {
  assert.equal(confidenceScore("medium"), 0.75);
  assert.equal(confidenceScore("low"), 0.35);
  assert.equal(confidenceScore("unknown-value"), 0.35);
});
