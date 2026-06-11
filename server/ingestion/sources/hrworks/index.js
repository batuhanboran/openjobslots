const { buildEvidenceMetadata, evaluatePublicPosting } = require("../../publicPostingGate");
const { decideDetailEscalation } = require("../../parserEvidence");
const { canonicalizePostingUrl, normalizePosting, validatePosting } = require("../../posting");
const { validateNormalizedPostingContract } = require("../../parserContract");

const parseJobs = require("./parse");
const baseNormalize = require("./normalize");

const ATS_KEY = "hrworks";
const PARSER_VERSION = "source-hrworks-v1";
const PARSER_CONFIDENCE = 0.75;
const SOURCE_FAMILY = "direct_json";

function discover(company = {}) {
  return {
    ats_key: ATS_KEY,
    source_family: SOURCE_FAMILY,
    company: {
      company_name: company.company_name || company.companyName || company.name,
      url_string: company.url_string || company.url,
      ATS_name: ATS_KEY
    },
    list_url: company.url_string || "",
    config: {},
    parser_version: PARSER_VERSION
  };
}

async function fetchList(company = {}, options = {}) {
  return [];
}

async function fetchDetail() {
  return null;
}

const parse = require('./parse');

const normalize = require('./normalize');

function validate(posting) {
  const basic = validatePosting(posting);
  if (!basic.ok) return basic;
  const contract = validateNormalizedPostingContract(posting);
  if (!contract.ok) return contract;
  if (!posting?.source_job_id) {
    return { ok: false, error: "missing source_job_id", status: "quarantined" };
  }
  return { ok: true, error: "", status: "valid" };
}

function validatePublic(posting) {
  return evaluatePublicPosting(posting, { parserVersion: PARSER_VERSION });
}

function rateLimit() {
  return {
    requestsPerMinute: 30,
    strategy: "direct-json-api-per-host-serialized"
  };
}

function qualityThreshold() {
  return {
    parse_success_minimum_pct: 95,
    max_batch_bad_row_pct: 5,
    requires_title_company_canonical_url: true,
    public_requires_geo_or_explicit_remote: true,
    ambiguous_rows: "quarantine"
  };
}

function fixtures() {
  return [
    `server/ingestion/sources/${ATS_KEY}/fixtures/list.json`,
    `server/ingestion/sources/${ATS_KEY}/fixtures/expected-normalized.json`,
    `server/ingestion/sources/${ATS_KEY}/fixtures/invalid-shapes.json`
  ];
}

module.exports = {
  atsKey: ATS_KEY,
  key: ATS_KEY,
  parserVersion: PARSER_VERSION,
  discover,
  fetchList,
  fetchDetail,
  parse,
  normalize,
  validate,
  validatePublic,
  rateLimit,
  qualityThreshold,
  fixtures
};
