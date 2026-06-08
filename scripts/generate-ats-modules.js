const fs = require('fs');
const path = require('path');

const cleanKeysPath = path.join(__dirname, '..', 'scratch', 'ats_100_clean_keys.json');

if (!fs.existsSync(cleanKeysPath)) {
  console.error('Clean keys JSON not found at:', cleanKeysPath);
  process.exit(1);
}

const newAtsList = JSON.parse(fs.readFileSync(cleanKeysPath, 'utf8'));
const sourcesDir = path.join(__dirname, '..', 'server', 'ingestion', 'sources');

console.log(`Loaded ${newAtsList.length} ATS platforms to generate.`);

newAtsList.forEach((ats, index) => {
  const atsKey = ats.key;
  const atsDir = path.join(sourcesDir, atsKey);
  const fixturesDir = path.join(atsDir, 'fixtures');

  // Mappings to standard families:
  // categories: json, xml, api -> direct_json, dom -> embedded_json
  let sourceFamily = 'direct_json';
  if (ats.category === 'dom') {
    sourceFamily = 'embedded_json';
  }

  // 1. Create directories
  if (!fs.existsSync(atsDir)) {
    fs.mkdirSync(atsDir, { recursive: true });
  }
  if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
  }

  // 2. Write fixtures/list.json
  const listJson = [];
  fs.writeFileSync(path.join(fixturesDir, 'list.json'), JSON.stringify(listJson, null, 2));

  // 3. Write fixtures/expected-normalized.json
  const expectedJson = [];
  fs.writeFileSync(path.join(fixturesDir, 'expected-normalized.json'), JSON.stringify(expectedJson, null, 2));

  // 4. Write fixtures/invalid-shapes.json
  const invalidJson = { cases: [] };
  fs.writeFileSync(path.join(fixturesDir, 'invalid-shapes.json'), JSON.stringify(invalidJson, null, 2));

  // 5. Write fixtures/company.json
  const companyJson = {
    company_name: ats.originalName,
    url_string: 'https://example.com/careers',
    ATS_name: atsKey
  };
  fs.writeFileSync(path.join(fixturesDir, 'company.json'), JSON.stringify(companyJson, null, 2));

  // 6. Write index.js with minimal contract
  const indexContent = `const { buildEvidenceMetadata, evaluatePublicPosting } = require("../../publicPostingGate");
const { decideDetailEscalation } = require("../../parserEvidence");
const { canonicalizePostingUrl, normalizePosting, validatePosting } = require("../../posting");
const { validateNormalizedPostingContract } = require("../../parserContract");

const ATS_KEY = "${atsKey}";
const PARSER_VERSION = "source-${atsKey}-v1";
const PARSER_CONFIDENCE = 0.75;
const SOURCE_FAMILY = "${sourceFamily}";

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

function parse(rawPayload, company = {}) {
  return [];
}

function normalize(posting, company = {}, options = {}) {
  const normalized = normalizePosting(posting, company, ATS_KEY, {
    parserVersion: PARSER_VERSION,
    confidence: options.confidence || PARSER_CONFIDENCE,
    ...options
  });
  normalized.parser_key = ATS_KEY;
  normalized.parser_version = PARSER_VERSION;
  normalized.parser_confidence = PARSER_CONFIDENCE;
  normalized.confidence_score = PARSER_CONFIDENCE;
  normalized.canonical_url = canonicalizePostingUrl(normalized.canonical_url || normalized.job_posting_url);
  normalized.job_posting_url = normalized.canonical_url;
  normalized.apply_url = canonicalizePostingUrl(normalized.apply_url || normalized.canonical_url);
  normalized.source_family = SOURCE_FAMILY;
  normalized.evidence = buildEvidenceMetadata(normalized, { parserVersion: PARSER_VERSION, sourceFamily: SOURCE_FAMILY });
  normalized.detail_escalation_decision = decideDetailEscalation(normalized, {
    sourceFamily: SOURCE_FAMILY,
    detailSupported: false
  });
  return normalized;
}

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
    \`server/ingestion/sources/\${ATS_KEY}/fixtures/list.json\`,
    \`server/ingestion/sources/\${ATS_KEY}/fixtures/expected-normalized.json\`,
    \`server/ingestion/sources/\${ATS_KEY}/fixtures/invalid-shapes.json\`
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
`;

  fs.writeFileSync(path.join(atsDir, 'index.js'), indexContent);
});

console.log('Successfully generated modular code and fixtures for 100 new ATS platforms!');
