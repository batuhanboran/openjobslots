const {
  ATS_FILTER_OPTION_ITEMS,
  collectPostingsForCompany,
  normalizeAtsFilterValue
} = require("../index");
const { UNSUPPORTED_ATS, getAdapterMetadata } = require("./adapter-metadata");
const { canonicalizePostingUrl, normalizePosting, validatePosting } = require("./posting");

const PARSER_VERSION = "legacy-adapter-v1";
const LEGACY_FETCH_ATS_NAME_OVERRIDES = {
  ashby: "ashbyhq"
};
const UNSUPPORTED_LEGACY_FETCH_ATS = UNSUPPORTED_ATS;

function confidenceToScore(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "medium") return 0.75;
  if (normalized === "medium-pending-fixture") return 0.65;
  if (normalized === "medium-low-pending-fixture") return 0.55;
  if (normalized === "low") return 0.35;
  return 0.45;
}

function createLegacyAdapter(item) {
  const atsKey = String(item?.value || "").trim();
  const displayName = String(item?.label || atsKey).trim();
  const metadata = getAdapterMetadata(atsKey, displayName);
  return {
    key: atsKey,
    displayName,
    parserVersion: PARSER_VERSION,
    metadata,
    detect(company) {
      return normalizeAtsFilterValue(company?.ATS_name) === atsKey;
    },
    buildRequests(company) {
      return [{
        url: String(company?.url_string || "").trim(),
        method: "GET",
        atsKey,
        companyName: String(company?.company_name || "").trim()
      }];
    },
    async fetch(company) {
      if (UNSUPPORTED_LEGACY_FETCH_ATS.has(atsKey)) {
        const error = new Error(`${atsKey} adapter has no implemented legacy collector`);
        error.ingestionErrorType = "parser_adapter_not_implemented";
        throw error;
      }
      return collectPostingsForCompany({
        ...company,
        ATS_name: LEGACY_FETCH_ATS_NAME_OVERRIDES[atsKey] || company?.ATS_name || atsKey
      });
    },
    parse(rawPostings) {
      return Array.isArray(rawPostings) ? rawPostings : [];
    },
    normalize(posting, company, options = {}) {
      return normalizePosting(posting, company, atsKey, {
        parserVersion: PARSER_VERSION,
        confidence: confidenceToScore(metadata.confidence),
        ...options
      });
    },
    validate(posting) {
      return validatePosting(posting);
    },
    cacheKey(company) {
      return `${atsKey}:${String(company?.url_string || "").trim()}`;
    },
    rateLimit() {
      return {
        requestsPerMinute: metadata.tier === "brittle-high-risk" ? 10 : 60,
        strategy: metadata.tier
      };
    },
    fixtures() {
      return metadata.fixtureStatus === "fixture-backed"
        ? [
            `server/ingestion/fixtures/${atsKey}-postings.json`,
            `server/ingestion/fixtures/${atsKey}-direct.json`
          ]
        : [];
    }
  };
}

const adapters = new Map();
for (const item of ATS_FILTER_OPTION_ITEMS) {
  const adapter = createLegacyAdapter(item);
  if (adapter.key) {
    adapters.set(adapter.key, adapter);
  }
}

function getAdapterForCompany(company) {
  const atsKey = normalizeAtsFilterValue(company?.ATS_name);
  return adapters.get(atsKey) || null;
}

module.exports = {
  LEGACY_FETCH_ATS_NAME_OVERRIDES,
  PARSER_VERSION,
  UNSUPPORTED_LEGACY_FETCH_ATS,
  adapters,
  canonicalizePostingUrl,
  getAdapterForCompany,
  normalizePosting,
  validatePosting
};
