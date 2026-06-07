const BLANK_VALUES = new Set([
  "",
  "unknown",
  "n/a",
  "na",
  "none",
  "null",
  "undefined",
  "not available",
  "not applicable",
  "not specified",
  "unspecified"
]);

const AMBIGUOUS_LOCATION_VALUES = new Set([
  "all locations",
  "anywhere",
  "district wide",
  "districtwide",
  "global",
  "multiple",
  "multiple locations",
  "remote",
  "remote only",
  "tbd",
  "to be determined",
  "various",
  "various locations",
  "worldwide",
  "work from home",
  "wfh"
]);

const AMBIGUOUS_COUNTRY_CODES = new Set(["in", "il", "la", "ma", "pa", "pr", "sc"]);

const EVIDENCE_SOURCES = Object.freeze({
  LIST_API: "list_api",
  DETAIL_API: "detail_api",
  EMBEDDED_JSON: "embedded_json",
  LABELED_HTML: "labeled_html",
  JSON_LD: "json_ld",
  URL: "url",
  TITLE: "title",
  EXISTING_VALUE: "existing_value",
  GENERIC_BODY_TEXT: "generic_body_text",
  NORMALIZED: "normalized",
  ABSENT: "absent",
  UNKNOWN: "unknown"
});

const EVIDENCE_STRENGTH = Object.freeze({
  [EVIDENCE_SOURCES.EXISTING_VALUE]: 90,
  [EVIDENCE_SOURCES.DETAIL_API]: 85,
  [EVIDENCE_SOURCES.JSON_LD]: 82,
  [EVIDENCE_SOURCES.LIST_API]: 78,
  [EVIDENCE_SOURCES.EMBEDDED_JSON]: 75,
  [EVIDENCE_SOURCES.LABELED_HTML]: 65,
  [EVIDENCE_SOURCES.URL]: 35,
  [EVIDENCE_SOURCES.TITLE]: 25,
  [EVIDENCE_SOURCES.NORMALIZED]: 20,
  [EVIDENCE_SOURCES.GENERIC_BODY_TEXT]: 5,
  [EVIDENCE_SOURCES.ABSENT]: 0,
  [EVIDENCE_SOURCES.UNKNOWN]: 0
});

const DETAIL_ESCALATION_DECISIONS = Object.freeze({
  DETAIL_NOT_NEEDED: "detail_not_needed",
  DETAIL_SUPPORTED: "detail_supported",
  DETAIL_NOT_SUPPORTED: "detail_not_supported",
  DETAIL_BLOCKED: "detail_blocked",
  DETAIL_REQUIRED_BUT_UNAVAILABLE: "detail_required_but_unavailable"
});

const FAILURE_REASONS = Object.freeze({
  LIST_MISSING_LOCATION: "list_missing_location",
  LIST_MISSING_REMOTE: "list_missing_remote",
  DETAIL_REQUIRED_BUT_UNAVAILABLE: "detail_required_but_unavailable",
  DETAIL_NO_STRUCTURED_LOCATION: "detail_no_structured_location",
  DETAIL_NO_EXPLICIT_REMOTE: "detail_no_explicit_remote",
  UNSUPPORTED_TENANT_SHAPE: "unsupported_tenant_shape",
  DUPLICATE_EXISTING_PUBLIC: "duplicate_existing_public",
  DUPLICATE_EXISTING_SOURCE_JOB_ID: "duplicate_existing_source_job_id",
  CANDIDATE_CLEAN_BUT_EXISTING: "candidate_clean_but_existing"
});

function asString(value) {
  return String(value ?? "").trim();
}

function asLower(value) {
  return asString(value).toLowerCase();
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hasValue(value) {
  return !BLANK_VALUES.has(asLower(value));
}

function normalizeRemoteType(value) {
  const normalized = asLower(value).replace(/[_\s]+/g, "-");
  if (normalized === "remote" || normalized === "hybrid" || normalized === "onsite") return normalized;
  if (normalized === "on-site" || normalized === "on-site-only" || normalized === "non-remote") return "onsite";
  return "unknown";
}

function getLocationText(posting = {}) {
  return asString(posting.location_text || posting.location);
}

function normalizeAmbiguousLocationText(locationText) {
  return asLower(locationText)
    .replace(/^[\s([{]+/, "")
    .replace(/[\s)\]}]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function locationLooksNarrativeText(locationText) {
  const text = asString(locationText).replace(/\s+/g, " ").trim();
  if (!text || text.length < 45) return false;
  const words = text.match(/[A-Za-z][A-Za-z'-]*/g) || [];
  if (words.length < 7) return false;
  const hasSentenceEnd = /[.!?]$/.test(text);
  const hasNarrativeCue = /\b(?:ability to|client[-\s]specific|collaborating|compliance|customers?|develop|ensuring|experience|external|internal|manage|provide|requirements?|responsibilit(?:y|ies)|skills?|supporting|team|while|working)\b/i.test(text);
  if (hasSentenceEnd && hasNarrativeCue) return true;
  return words.length >= 10 && /\b(?:responsible for|you will|we are|ability to|experience with|ensuring that)\b/i.test(text);
}

function locationLooksAmbiguous(locationText, posting = {}) {
  const location = normalizeAmbiguousLocationText(locationText);
  if (!location) return false;
  if (AMBIGUOUS_LOCATION_VALUES.has(location)) return true;
  if (/^(multiple|various)\b/.test(location)) return true;
  if (/^(multiple|various)\s+(locations?|states?|countries?|cities?|regions?|areas?)\b/.test(location)) return true;
  if (/\b(multiple|various) locations?\b/.test(location)) return true;
  const country = asLower(posting.country);
  const region = asLower(posting.region || posting.state);
  const city = asLower(posting.city);
  if (!country && !city && !region && AMBIGUOUS_COUNTRY_CODES.has(location)) return true;
  return false;
}

function hasConcreteLocationText(locationText) {
  const location = normalizeAmbiguousLocationText(locationText);
  if (!location || locationLooksAmbiguous(location)) return false;
  if (locationLooksNarrativeText(locationText)) return false;
  if (/\b(remote|anywhere|worldwide|global|work from home|wfh)\b/.test(location)) return false;
  return true;
}

function hasUsefulGeoEvidence(posting = {}) {
  if (hasValue(posting.country) || hasValue(posting.region || posting.state)) return true;
  if (hasValue(posting.city) && !locationLooksNarrativeText(posting.city)) return true;
  return hasConcreteLocationText(getLocationText(posting));
}

function hasExplicitRemoteEvidence(posting = {}) {
  const remoteType = normalizeRemoteType(posting.remote_type);
  if (remoteType === "unknown") return false;
  const explicitFields = [
    posting.remote_type,
    posting.workplace_type,
    posting.workplaceType,
    posting.location_type,
    posting.locationType,
    posting.workLocationOption,
    posting.is_remote,
    posting.isRemote,
    posting.remote_label,
    posting.workplace
  ];
  if (explicitFields.some((value) => hasValue(value))) return true;
  const evidence = posting.source_evidence || {};
  if (hasValue(evidence.remote_source) || hasValue(evidence.remote_path) || hasValue(evidence.remote_selector)) return true;
  const textEvidence = [
    getLocationText(posting)
  ].map(asLower).join(" ");
  if (remoteType === "remote") return /\b(remote|work from home|wfh|virtual)\b/.test(textEvidence);
  if (remoteType === "hybrid") return /\bhybrid\b/.test(textEvidence);
  if (remoteType === "onsite") return /\b(on[-\s]?site|onsite|in[-\s]?person)\b/.test(textEvidence);
  return false;
}

function evidenceSourceFromFamily(sourceFamily) {
  const family = asLower(sourceFamily);
  if (family === "embedded_json") return EVIDENCE_SOURCES.EMBEDDED_JSON;
  if (family === "html_detail" || family === "public_sector" || family === "brittle") {
    return EVIDENCE_SOURCES.LABELED_HTML;
  }
  return EVIDENCE_SOURCES.LIST_API;
}

function evidenceSourceFromHint(hint, fallback = EVIDENCE_SOURCES.UNKNOWN) {
  const value = asLower(hint).replace(/[-\s]+/g, "_");
  if (!value) return fallback;
  if (value.includes("json_ld")) return EVIDENCE_SOURCES.JSON_LD;
  if (value.includes("detail_api")) return EVIDENCE_SOURCES.DETAIL_API;
  if (value.includes("embedded") || value.includes("hidden_json") || value.includes("page_data")) return EVIDENCE_SOURCES.EMBEDDED_JSON;
  if (value.includes("labeled") || value.includes("detail") || value.includes("html")) return EVIDENCE_SOURCES.LABELED_HTML;
  if (value.includes("api") || value.includes("column") || value.includes("payload") || value.includes("public_app")) return EVIDENCE_SOURCES.LIST_API;
  if (value.includes("url")) return EVIDENCE_SOURCES.URL;
  if (value.includes("title")) return EVIDENCE_SOURCES.TITLE;
  if (value.includes("body") || value.includes("description")) return EVIDENCE_SOURCES.GENERIC_BODY_TEXT;
  if (value.includes("existing")) return EVIDENCE_SOURCES.EXISTING_VALUE;
  if (value.includes("normalized")) return EVIDENCE_SOURCES.NORMALIZED;
  return fallback;
}

function makeFieldEvidence(field, value, options = {}) {
  const cleaned = asString(value);
  const present = hasValue(cleaned);
  const evidenceSource = present
    ? evidenceSourceFromHint(options.evidence_source || options.source, options.defaultSource || EVIDENCE_SOURCES.UNKNOWN)
    : EVIDENCE_SOURCES.ABSENT;
  return {
    present,
    value: cleaned,
    source: evidenceSource,
    evidence_source: evidenceSource,
    evidence_path: asString(options.evidence_path || options.path || options.selector || ""),
    confidence: Math.max(0, Math.min(1, asNumber(options.confidence, present ? 0.5 : 0))),
    rule_name: asString(options.rule_name || ""),
    source_url: asString(options.source_url || ""),
    detail_url: asString(options.detail_url || "")
  };
}

function sourceEvidenceValue(sourceEvidence = {}, field, suffix, fallback = "") {
  return sourceEvidence[`${field}_${suffix}`] || fallback;
}

function fieldSource(sourceEvidence, field, defaultSource) {
  return sourceEvidenceValue(sourceEvidence, field, "source") ||
    sourceEvidenceValue(sourceEvidence, field, "evidence_source") ||
    (field === "country" || field === "region" || field === "city" ? sourceEvidence.location_source : "") ||
    (field === "posting_date" ? sourceEvidence.posting_date_source : "") ||
    defaultSource;
}

function fieldPath(sourceEvidence, field, fallback = "") {
  return sourceEvidenceValue(sourceEvidence, field, "path") ||
    sourceEvidenceValue(sourceEvidence, field, "selector") ||
    fallback;
}

function buildFieldEvidenceMetadata(posting = {}, options = {}) {
  const sourceEvidence = posting.source_evidence || {};
  const sourceFamily = options.sourceFamily || posting.source_family || sourceEvidence.source_family || "";
  const defaultSource = options.defaultEvidenceSource || evidenceSourceFromFamily(sourceFamily);
  const confidence = Math.max(0, Math.min(1, asNumber(
    posting.parser_confidence ?? posting.confidence ?? posting.confidence_score,
    options.confidence || 0.5
  )));
  const sourceUrl = asString(sourceEvidence.list_url || sourceEvidence.source_url || posting.source_url || "");
  const detailUrl = asString(sourceEvidence.detail_url || "");
  const remoteType = normalizeRemoteType(posting.remote_type);
  const postingDate = posting.posted_at || posting.posting_date || posting.posted_at_epoch || posting.posting_date_epoch;
  const parserVersion = asString(options.parserVersion || posting.parser_version);
  const locationText = getLocationText(posting);
  const sourceJobId = asString(
    posting.source_job_id ||
    posting.source_derived_id ||
    posting.stable_source_id ||
    posting.job_id ||
    posting.id
  );

  const metadata = {
    title: makeFieldEvidence("title", posting.title || posting.position_name, {
      source: fieldSource(sourceEvidence, "title", defaultSource),
      evidence_path: fieldPath(sourceEvidence, "title", "title"),
      confidence,
      rule_name: sourceEvidence.title_rule_name || "source_title",
      source_url: sourceUrl,
      detail_url: detailUrl
    }),
    company: makeFieldEvidence("company", posting.company || posting.company_name || posting.source_company, {
      source: fieldSource(sourceEvidence, "company", defaultSource),
      evidence_path: fieldPath(sourceEvidence, "company", "company"),
      confidence,
      rule_name: sourceEvidence.company_rule_name || "source_company",
      source_url: sourceUrl,
      detail_url: detailUrl
    }),
    canonical_url: makeFieldEvidence("canonical_url", posting.canonical_url || posting.job_posting_url || posting.apply_url || posting.source_url, {
      source: fieldSource(sourceEvidence, "canonical_url", EVIDENCE_SOURCES.URL),
      evidence_path: fieldPath(sourceEvidence, "canonical_url", "canonical_url"),
      confidence,
      rule_name: sourceEvidence.canonical_url_rule_name || "source_canonical_url",
      source_url: sourceUrl,
      detail_url: detailUrl
    }),
    source_job_id: makeFieldEvidence("source_job_id", sourceJobId, {
      source: fieldSource(sourceEvidence, "source_job_id", defaultSource),
      evidence_path: fieldPath(sourceEvidence, "source_job_id", "source_job_id"),
      confidence,
      rule_name: sourceEvidence.source_job_id_rule_name || "source_job_id",
      source_url: sourceUrl,
      detail_url: detailUrl
    }),
    location_text: makeFieldEvidence("location_text", locationText, {
      source: fieldSource(sourceEvidence, "location", defaultSource),
      evidence_path: fieldPath(sourceEvidence, "location", "location"),
      confidence,
      rule_name: sourceEvidence.location_rule_name || "source_location",
      source_url: sourceUrl,
      detail_url: detailUrl
    }),
    country: makeFieldEvidence("country", posting.country, {
      source: fieldSource(sourceEvidence, "country", defaultSource),
      evidence_path: fieldPath(sourceEvidence, "country", "country"),
      confidence,
      rule_name: sourceEvidence.country_rule_name || "normalize_country_from_source_location",
      source_url: sourceUrl,
      detail_url: detailUrl
    }),
    region: makeFieldEvidence("region", posting.region || posting.state, {
      source: fieldSource(sourceEvidence, "region", defaultSource),
      evidence_path: fieldPath(sourceEvidence, "region", "region"),
      confidence,
      rule_name: sourceEvidence.region_rule_name || "normalize_region_from_source_location",
      source_url: sourceUrl,
      detail_url: detailUrl
    }),
    city: makeFieldEvidence("city", posting.city, {
      source: fieldSource(sourceEvidence, "city", defaultSource),
      evidence_path: fieldPath(sourceEvidence, "city", "city"),
      confidence,
      rule_name: sourceEvidence.city_rule_name || "normalize_city_from_source_location",
      source_url: sourceUrl,
      detail_url: detailUrl
    }),
    remote_type: makeFieldEvidence("remote_type", remoteType === "unknown" ? "" : remoteType, {
      source: fieldSource(sourceEvidence, "remote", defaultSource),
      evidence_path: fieldPath(sourceEvidence, "remote", "remote_type"),
      confidence,
      rule_name: sourceEvidence.remote_rule_name || (remoteType === "onsite" ? "normalize_remote_type_from_source_location" : "source_remote_type"),
      source_url: sourceUrl,
      detail_url: detailUrl
    }),
    posting_date: makeFieldEvidence("posting_date", postingDate, {
      source: fieldSource(sourceEvidence, "posting_date", defaultSource),
      evidence_path: fieldPath(sourceEvidence, "posting_date", "posting_date"),
      confidence,
      rule_name: sourceEvidence.posting_date_rule_name || "source_posting_date",
      source_url: sourceUrl,
      detail_url: detailUrl
    }),
    parser_key: makeFieldEvidence("parser_key", posting.parser_key || posting.ats_key || posting.source_ats || posting.ats || "unknown", {
      source: "normalized",
      evidence_path: "parser_key",
      confidence: 1,
      rule_name: "parser_identity"
    }),
    parser_version: makeFieldEvidence("parser_version", parserVersion, {
      source: "normalized",
      evidence_path: "parser_version",
      confidence: 1,
      rule_name: "parser_identity"
    }),
    confidence: {
      present: true,
      value: confidence,
      source: "parser_confidence",
      evidence_source: "normalized",
      evidence_path: "parser_confidence",
      confidence: 1,
      rule_name: "parser_confidence",
      source_url: sourceUrl,
      detail_url: detailUrl
    },
    confidence_score: {
      present: true,
      value: confidence,
      source: "parser_confidence",
      evidence_source: "normalized",
      evidence_path: "parser_confidence",
      confidence: 1,
      rule_name: "parser_confidence",
      source_url: sourceUrl,
      detail_url: detailUrl
    },
    quality_score: {
      present: true,
      value: Math.max(0, Math.min(100, Math.round(asNumber(posting.quality_score ?? posting.qualityScore, confidence * 100)))),
      source: Number.isFinite(asNumber(posting.quality_score ?? posting.qualityScore, NaN))
        ? "stored_quality_score"
        : "confidence_fallback",
      evidence_source: "normalized",
      evidence_path: "quality_score",
      confidence: 1,
      rule_name: "quality_score"
    }
  };
  metadata.location_text.ambiguous = locationLooksAmbiguous(locationText, posting);
  metadata.remote_type.normalized = remoteType;
  metadata.remote_type.explicit = hasExplicitRemoteEvidence({ ...posting, remote_type: remoteType });
  return metadata;
}

function evidenceStrength(evidence = {}) {
  return EVIDENCE_STRENGTH[evidence.evidence_source || evidence.source] || 0;
}

function remoteEvidencePriority(evidence = {}) {
  const value = normalizeRemoteType(evidence.value);
  const explicit = evidence.explicit === true || /\bsource|explicit|remote|workplace|labeled/i.test(evidence.rule_name || "");
  if ((value === "remote" || value === "hybrid") && explicit) return 1000;
  if (value === "onsite" && /infer|physical|location/i.test(evidence.rule_name || "")) return -10;
  return 0;
}

function chooseStrongerEvidence(existing, next, field = "") {
  if (!existing?.present) return next;
  if (!next?.present) return existing;
  const existingScore = evidenceStrength(existing) + (field === "remote_type" ? remoteEvidencePriority(existing) : 0);
  const nextScore = evidenceStrength(next) + (field === "remote_type" ? remoteEvidencePriority(next) : 0);
  if (nextScore > existingScore) return next;
  if (nextScore < existingScore) return existing;
  return Number(next.confidence || 0) > Number(existing.confidence || 0) ? next : existing;
}

function mergeFieldEvidence(existing = {}, next = {}) {
  const output = { ...existing };
  for (const [field, evidence] of Object.entries(next || {})) {
    output[field] = chooseStrongerEvidence(output[field], evidence, field);
  }
  return output;
}

function decideDetailEscalation(posting = {}, options = {}) {
  const sourceEvidence = posting.source_evidence || {};
  const sourceFamily = asLower(options.sourceFamily || posting.source_family || sourceEvidence.source_family);
  const remoteType = normalizeRemoteType(posting.remote_type);
  const usefulGeo = hasUsefulGeoEvidence(posting);
  const explicitRemote = remoteType !== "unknown" && hasExplicitRemoteEvidence({ ...posting, remote_type: remoteType });
  const needDetailForGeo = !usefulGeo;
  const needDetailForRemote = remoteType === "unknown" || ((remoteType === "remote" || remoteType === "hybrid") && !explicitRemote);
  const needDetailForDate = !hasValue(posting.posting_date || posting.posted_at || posting.posting_date_epoch || posting.posted_at_epoch);
  const hasNeed = needDetailForGeo || needDetailForRemote || needDetailForDate;
  const detailSupported = options.detailSupported ?? sourceEvidence.detail_supported ?? (
    ["enterprise_api", "html_detail", "public_sector", "brittle"].includes(sourceFamily)
  );
  const detailBlocked = Boolean(sourceEvidence.detail_blocked || sourceEvidence.detail_fetch_blocked);
  let decision = DETAIL_ESCALATION_DECISIONS.DETAIL_NOT_NEEDED;
  if (detailBlocked) decision = DETAIL_ESCALATION_DECISIONS.DETAIL_BLOCKED;
  else if (!hasNeed) decision = DETAIL_ESCALATION_DECISIONS.DETAIL_NOT_NEEDED;
  else if (detailSupported) decision = DETAIL_ESCALATION_DECISIONS.DETAIL_SUPPORTED;
  else decision = DETAIL_ESCALATION_DECISIONS.DETAIL_NOT_SUPPORTED;

  const failureReasons = [];
  if (needDetailForGeo) failureReasons.push(FAILURE_REASONS.LIST_MISSING_LOCATION);
  if (needDetailForRemote) failureReasons.push(FAILURE_REASONS.LIST_MISSING_REMOTE);
  if (hasNeed && !detailSupported) failureReasons.push(FAILURE_REASONS.DETAIL_REQUIRED_BUT_UNAVAILABLE);
  if (sourceEvidence.detail_url && needDetailForGeo) failureReasons.push(FAILURE_REASONS.DETAIL_NO_STRUCTURED_LOCATION);
  if (sourceEvidence.detail_url && needDetailForRemote) failureReasons.push(FAILURE_REASONS.DETAIL_NO_EXPLICIT_REMOTE);

  return {
    need_detail_for_geo: needDetailForGeo,
    need_detail_for_remote: needDetailForRemote,
    need_detail_for_date: needDetailForDate,
    detail_not_supported: decision === DETAIL_ESCALATION_DECISIONS.DETAIL_NOT_SUPPORTED,
    detail_blocked: decision === DETAIL_ESCALATION_DECISIONS.DETAIL_BLOCKED,
    detail_not_needed: decision === DETAIL_ESCALATION_DECISIONS.DETAIL_NOT_NEEDED,
    detail_supported: decision === DETAIL_ESCALATION_DECISIONS.DETAIL_SUPPORTED,
    decision,
    failure_reasons: Array.from(new Set(failureReasons))
  };
}

function summarizeEvidence(evidence = {}) {
  const output = {};
  for (const field of [
    "title",
    "company",
    "canonical_url",
    "source_job_id",
    "location_text",
    "country",
    "region",
    "city",
    "remote_type",
    "posting_date"
  ]) {
    const item = evidence[field] || {};
    output[field] = {
      present: Boolean(item.present),
      evidence_source: item.evidence_source || item.source || "",
      evidence_path: item.evidence_path || "",
      confidence: Number(item.confidence || 0),
      rule_name: item.rule_name || ""
    };
  }
  return output;
}

module.exports = {
  DETAIL_ESCALATION_DECISIONS,
  EVIDENCE_SOURCES,
  FAILURE_REASONS,
  buildFieldEvidenceMetadata,
  decideDetailEscalation,
  evidenceSourceFromFamily,
  evidenceSourceFromHint,
  makeFieldEvidence,
  mergeFieldEvidence,
  chooseStrongerEvidence,
  hasExplicitRemoteEvidence,
  hasUsefulGeoEvidence,
  locationLooksAmbiguous,
  normalizeRemoteType,
  summarizeEvidence
};
