const { validatePosting } = require("./posting");

const PARSER_CONTRACT_VERSION = "parser-contract-v1";

const REQUIRED_POSTING_FIELDS = Object.freeze([
  "title",
  "company",
  "canonical_url",
  "apply_url",
  "ats_key",
  "parser_version",
  "parser_confidence"
]);

const OPTIONAL_POSTING_FIELDS = Object.freeze([
  "source_job_id",
  "location_text",
  "country",
  "region",
  "city",
  "remote_type",
  "department",
  "employment_type",
  "description_plain",
  "description_html",
  "posted_at",
  "posted_at_epoch",
  "first_seen_epoch",
  "last_seen_epoch",
  "raw_hash"
]);

const NORMALIZED_POSTING_FIELDS = Object.freeze([
  "source_job_id",
  "ats_key",
  "company",
  "title",
  "location_text",
  "country",
  "region",
  "city",
  "remote_type",
  "department",
  "employment_type",
  "description_plain",
  "description_html",
  "canonical_url",
  "apply_url",
  "posted_at",
  "posted_at_epoch",
  "first_seen_epoch",
  "last_seen_epoch",
  "raw_hash",
  "parser_version",
  "parser_confidence"
]);

const CONFIDENCE_LEVELS = Object.freeze({
  unsupported: 0,
  low: 0.35,
  "medium-low-pending-fixture": 0.55,
  "medium-pending-fixture": 0.65,
  medium: 0.75,
  high: 0.9
});

function normalizeConfidenceLevel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(CONFIDENCE_LEVELS, normalized)
    ? normalized
    : "low";
}

function confidenceScore(value) {
  return CONFIDENCE_LEVELS[normalizeConfidenceLevel(value)];
}

function validateNormalizedPostingContract(posting) {
  const validation = validatePosting(posting);
  if (!validation.ok) return validation;

  for (const field of ["ats_key", "parser_version"]) {
    if (!String(posting?.[field] || "").trim()) {
      return { ok: false, error: `missing ${field}` };
    }
  }
  if (typeof posting?.parser_confidence !== "number" || Number.isNaN(posting.parser_confidence)) {
    return { ok: false, error: "missing parser_confidence" };
  }
  return { ok: true, error: "" };
}

module.exports = {
  CONFIDENCE_LEVELS,
  NORMALIZED_POSTING_FIELDS,
  OPTIONAL_POSTING_FIELDS,
  PARSER_CONTRACT_VERSION,
  REQUIRED_POSTING_FIELDS,
  confidenceScore,
  normalizeConfidenceLevel,
  validateNormalizedPostingContract
};
