const DAY_SECONDS = 24 * 60 * 60;
const STALE_CACHE_DAYS = 90;
const MIN_REASONABLE_POSTED_AT_EPOCH = 631152000; // 1990-01-01

function asString(value) {
  return String(value ?? "").trim();
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function epochToIso(value) {
  const epoch = asNumber(value, 0);
  if (!epoch || epoch <= 0) return "";
  const date = new Date(epoch * 1000);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function normalizeRemoteType(value) {
  const normalized = asString(value).toLowerCase();
  if (["remote", "hybrid", "onsite", "on_site", "on-site", "non_remote"].includes(normalized)) {
    if (normalized === "on_site" || normalized === "on-site" || normalized === "non_remote") return "onsite";
    return normalized;
  }
  return "unknown";
}

function getCanonicalUrl(posting = {}) {
  return asString(posting.canonical_url || posting.job_posting_url || posting.apply_url || posting.source_url);
}

function getTitle(posting = {}) {
  return asString(posting.title || posting.position_name);
}

function getCompany(posting = {}) {
  return asString(posting.company || posting.company_name || posting.source_company);
}

function getAtsKey(posting = {}) {
  return asString(posting.ats_key || posting.ats || posting.ATS_name || posting.source_ats).toLowerCase();
}

function getLocationText(posting = {}) {
  return asString(posting.location_text || posting.location);
}

function getParserVersion(posting = {}) {
  return asString(posting.parser_version || posting.parser_key);
}

function getConfidenceScore(posting = {}) {
  return asNumber(posting.parser_confidence ?? posting.confidence ?? posting.confidence_score, 0);
}

function uniqueFlags(flags) {
  return Array.from(new Set((Array.isArray(flags) ? flags : []).map(asString).filter(Boolean))).sort();
}

function parseQualityFlags(value) {
  if (Array.isArray(value)) return uniqueFlags(value);
  const raw = asString(value);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return uniqueFlags(parsed);
  } catch {
    return uniqueFlags(raw.split(","));
  }
}

function addFlag(flags, condition, flag) {
  if (condition) flags.push(flag);
}

function getQualityFlags(posting = {}, options = {}) {
  const nowEpoch = asNumber(options.nowEpoch, Math.floor(Date.now() / 1000));
  const flags = parseQualityFlags(posting.quality_flags);
  const title = getTitle(posting);
  const company = getCompany(posting);
  const canonicalUrl = getCanonicalUrl(posting);
  const sourceJobId = asString(posting.source_job_id);
  const locationText = getLocationText(posting);
  const country = asString(posting.country);
  const region = asString(posting.region);
  const city = asString(posting.city);
  const remoteType = normalizeRemoteType(posting.remote_type);
  const parserVersion = getParserVersion(posting);
  const confidenceScore = getConfidenceScore(posting);
  const postedAtEpoch = asNumber(posting.posted_at_epoch ?? posting.posting_date_epoch, 0);
  const postingDateText = asString(posting.posted_at || posting.posting_date);
  const lastSeenEpoch = asNumber(posting.last_seen_epoch, 0);
  const validationStatus = asString(posting.validation_status).toLowerCase();
  const validationError = asString(posting.validation_error || posting.rejection_reason);

  addFlag(flags, !title, "missing_title");
  addFlag(flags, !company, "missing_company");
  addFlag(flags, !canonicalUrl, "missing_url");
  addFlag(flags, !sourceJobId, "missing_source_job_id");
  addFlag(flags, !parserVersion, "missing_parser_version");
  addFlag(flags, confidenceScore > 0 && confidenceScore < 0.55, "parser_confidence_low");
  addFlag(flags, confidenceScore <= 0, "missing_parser_confidence");
  addFlag(flags, !locationText, "missing_location_text");
  addFlag(flags, Boolean(locationText) && (!country || !region), "suspicious_location_parsing");
  addFlag(flags, Boolean(country || region) && !city, "missing_city");
  addFlag(flags, !country, "missing_country");
  addFlag(flags, !region, "missing_region");
  addFlag(flags, !remoteType || remoteType === "unknown", "weak_remote_classification");
  addFlag(flags, !postingDateText && !postedAtEpoch, "missing_posted_at");
  addFlag(
    flags,
    postedAtEpoch > 0 && (postedAtEpoch < MIN_REASONABLE_POSTED_AT_EPOCH || postedAtEpoch > nowEpoch + DAY_SECONDS),
    "invalid_posted_at"
  );
  addFlag(flags, lastSeenEpoch > 0 && lastSeenEpoch < nowEpoch - STALE_CACHE_DAYS * DAY_SECONDS, "stale_cache");
  addFlag(flags, validationStatus === "invalid" || Boolean(validationError), "rejected");
  addFlag(flags, Boolean(options.duplicateOf || posting.duplicate_of), "duplicate");
  addFlag(flags, Boolean(posting.hidden), "hidden");

  return uniqueFlags(flags);
}

function scorePostingQuality(flagsInput, posting = {}) {
  const flags = uniqueFlags(flagsInput);
  const penalties = {
    missing_title: 35,
    missing_company: 30,
    missing_url: 35,
    rejected: 35,
    duplicate: 20,
    invalid_posted_at: 25,
    stale_cache: 20,
    missing_location_text: 16,
    suspicious_location_parsing: 14,
    missing_country: 12,
    missing_region: 8,
    missing_city: 4,
    weak_remote_classification: 8,
    missing_posted_at: 6,
    missing_source_job_id: 10,
    missing_parser_version: 12,
    missing_parser_confidence: 12,
    parser_confidence_low: 10,
    hidden: 15
  };
  const explicitScore = asNumber(posting.quality_score, NaN);
  if (Number.isFinite(explicitScore) && explicitScore > 0) {
    return Math.max(0, Math.min(100, Math.round(explicitScore)));
  }
  const penalty = flags.reduce((sum, flag) => sum + (penalties[flag] || 2), 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

function getRejectionReason(posting = {}, flags = []) {
  const explicit = asString(posting.rejection_reason || posting.validation_error);
  if (explicit) return explicit.slice(0, 240);
  const requiredFlags = flags.filter((flag) => ["missing_title", "missing_company", "missing_url", "rejected"].includes(flag));
  return requiredFlags.length > 0 ? requiredFlags.join(", ") : "";
}

function buildQualityMetadata(posting = {}, options = {}) {
  const flags = getQualityFlags(posting, options);
  const score = scorePostingQuality(flags, posting);
  const nowEpoch = asNumber(options.nowEpoch, Math.floor(Date.now() / 1000));
  const lastSeenEpoch = asNumber(posting.last_seen_epoch, 0);
  const firstSeenEpoch = asNumber(posting.first_seen_epoch, 0);
  const cacheState =
    asString(posting.cache_state) ||
    (asString(posting.validation_status) === "invalid"
      ? "rejected"
      : asString(posting.raw_payload_hash || posting.raw_hash)
        ? "cached"
        : "read_model");
  return {
    quality_score: score,
    confidence_score: getConfidenceScore(posting),
    quality_flags: flags,
    rejection_reason: getRejectionReason(posting, flags),
    duplicate_of: asString(options.duplicateOf || posting.duplicate_of),
    canonical_key: getCanonicalUrl(posting),
    parser_key: getParserVersion(posting),
    parser_version: getParserVersion(posting),
    source_ats: getAtsKey(posting),
    source_company: getCompany(posting),
    source_url: getCanonicalUrl(posting),
    source_job_id: asString(posting.source_job_id),
    normalized_location: {
      location_text: getLocationText(posting),
      country: asString(posting.country),
      region: asString(posting.region),
      city: asString(posting.city),
      remote_type: normalizeRemoteType(posting.remote_type)
    },
    first_seen_epoch: firstSeenEpoch,
    first_seen_at: epochToIso(firstSeenEpoch),
    last_seen_epoch: lastSeenEpoch,
    last_seen_at: epochToIso(lastSeenEpoch),
    cache_state: cacheState,
    freshness: {
      state:
        lastSeenEpoch > 0 && lastSeenEpoch < nowEpoch - STALE_CACHE_DAYS * DAY_SECONDS
          ? "stale"
          : lastSeenEpoch > 0
            ? "fresh"
            : "unknown",
      age_seconds: lastSeenEpoch > 0 ? Math.max(0, nowEpoch - lastSeenEpoch) : null
    }
  };
}

function buildStoredQualityFields(posting = {}, options = {}) {
  const metadata = buildQualityMetadata(posting, options);
  return {
    quality_score: metadata.quality_score,
    quality_flags: JSON.stringify(metadata.quality_flags),
    rejection_reason: metadata.rejection_reason
  };
}

module.exports = {
  MIN_REASONABLE_POSTED_AT_EPOCH,
  STALE_CACHE_DAYS,
  buildQualityMetadata,
  buildStoredQualityFields,
  epochToIso,
  getQualityFlags,
  parseQualityFlags,
  scorePostingQuality
};
