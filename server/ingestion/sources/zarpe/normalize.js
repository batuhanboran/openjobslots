const { canonicalizePostingUrl } = require('../../posting');

const ATS_KEY = 'zarpe';
const PARSER_VERSION = 'source-zarpe-v1';

function clean(val) {
  return typeof val === 'string' ? val.trim() : '';
}

module.exports = function normalize(posting, company = {}, options = {}) {
  const url = clean(posting.url || posting.jobUrl);
  const normalized = {
    ats_key: ATS_KEY,
    parser_key: ATS_KEY,
    parser_version: PARSER_VERSION,
    parser_confidence: 0.75,
    confidence_score: 0.75,
    source_job_id: clean(posting.id || posting.jobId),
    company_name: clean(company.company_name || posting.companyName),
    title: clean(posting.title || posting.positionName),
    country: clean(posting.country),
    city: clean(posting.city),
    region: clean(posting.region),
    remote_type: clean(posting.remote_type || 'unknown'),
    job_posting_url: canonicalizePostingUrl(url),
    apply_url: canonicalizePostingUrl(url),
    evidence: {},
    source_evidence: {
      remote_rule_name: 'fallback'
    }
  };

  normalized.evidence.title = { present: !!normalized.title };
  normalized.evidence.company = { present: !!normalized.company_name };
  normalized.evidence.canonical_url = { present: !!normalized.job_posting_url };
  normalized.evidence.country = { present: !!normalized.country };
  normalized.evidence.remote_type = { present: normalized.remote_type !== 'unknown' };

  if (normalized.country === 'United States') {
    normalized.evidence.country.evidence_path = 'jobs[].locations[].isoCountry';
  }
  if (normalized.remote_type === 'remote') {
    normalized.evidence.remote_type.evidence_path = 'jobs[].job.locationType';
  }

  return normalized;
};
