const { buildFieldEvidenceMetadata } = require("./parserEvidence");

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

function isBlankLike(value) {
  return BLANK_VALUES.has(asLower(value));
}

function normalizeRemoteType(value) {
  const normalized = asLower(value).replace(/[_\s]+/g, "-");
  if (normalized === "remote" || normalized === "hybrid" || normalized === "onsite") return normalized;
  if (normalized === "on-site" || normalized === "on-site-only" || normalized === "non-remote") return "onsite";
  return "unknown";
}

function getTitle(posting = {}) {
  return asString(posting.title || posting.position_name);
}

function getCompany(posting = {}) {
  return asString(posting.company || posting.company_name || posting.source_company);
}

function getCanonicalUrl(posting = {}) {
  return asString(posting.canonical_url || posting.job_posting_url || posting.apply_url || posting.source_url);
}

function getLocationText(posting = {}) {
  return asString(posting.location_text || posting.location);
}

function getParserVersion(posting = {}) {
  return asString(posting.parser_version);
}

function getParserKey(posting = {}) {
  return asString(posting.parser_key || posting.ats_key || posting.source_ats || posting.ats || "unknown").toLowerCase();
}

function getConfidence(posting = {}) {
  return asNumber(posting.parser_confidence ?? posting.confidence ?? posting.confidence_score, 0.5);
}

function getQualityScore(posting = {}, fallbackConfidence = 0.5) {
  const explicit = asNumber(posting.quality_score ?? posting.qualityScore, NaN);
  if (Number.isFinite(explicit)) return Math.max(0, Math.min(100, Math.round(explicit)));
  return Math.max(0, Math.min(100, Math.round(asNumber(fallbackConfidence, 0.5) * 100)));
}

function getPublicThresholds(options = {}, env = process.env) {
  return {
    minQualityScore: Math.max(0, Math.min(100, asNumber(
      options.minQualityScore ?? env.OPENJOBSLOTS_PUBLIC_MIN_QUALITY_SCORE,
      35
    ))),
    minConfidenceScore: Math.max(0, Math.min(1, asNumber(
      options.minConfidenceScore ?? env.OPENJOBSLOTS_PUBLIC_MIN_CONFIDENCE_SCORE,
      0.35
    )))
  };
}

function hasValue(value) {
  return !isBlankLike(value);
}

function createEvidence(value, source, extra = {}) {
  const cleaned = asString(value);
  return {
    present: hasValue(cleaned),
    value: cleaned,
    source: hasValue(cleaned) ? source : "absent",
    ...extra
  };
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
  const directFields = [
    posting.remote_type,
    posting.workplace_type,
    posting.workplaceType,
    posting.location_type,
    posting.locationType,
    posting.workLocationOption,
    posting.is_remote,
    posting.isRemote
  ];
  if (directFields.some((value) => hasValue(value))) return true;
  const textEvidence = [
    getLocationText(posting),
    posting.remote_label,
    posting.workplace,
    posting.title,
    posting.position_name
  ].map(asLower).join(" ");
  if (remoteType === "remote") return /\b(remote|work from home|wfh|virtual)\b/.test(textEvidence);
  if (remoteType === "hybrid") return /\bhybrid\b/.test(textEvidence);
  if (remoteType === "onsite") return /\b(on[-\s]?site|onsite|in[-\s]?person)\b/.test(textEvidence);
  return false;
}

function buildEvidenceMetadata(posting = {}, options = {}) {
  return buildFieldEvidenceMetadata(posting, {
    parserVersion: asString(options.parserVersion || getParserVersion(posting)),
    sourceFamily: options.sourceFamily || posting.source_family,
    confidence: Math.max(0, Math.min(1, getConfidence(posting))),
    qualityScore: getQualityScore(posting, getConfidence(posting))
  });
}

function evaluatePublicPosting(posting = {}, options = {}) {
  const evidence = buildEvidenceMetadata(posting, options);
  const thresholds = getPublicThresholds(options);
  const reasonCodes = [];
  const requiredMissing = [];

  if (!evidence.title.present) requiredMissing.push("missing_title");
  if (!evidence.company.present) requiredMissing.push("missing_company");
  if (!evidence.canonical_url.present) requiredMissing.push("missing_canonical_url");

  if (requiredMissing.length > 0) {
    return {
      status: "rejected",
      public: false,
      ok: false,
      reason_codes: requiredMissing,
      reason: requiredMissing.join(", "),
      evidence,
      retry_detail_refetch_eligible: false,
      confidence: Math.max(0, Number(evidence.confidence.value || 0) - 0.25)
    };
  }

  const remoteType = evidence.remote_type.normalized || "unknown";
  const usefulGeo = hasUsefulGeoEvidence(posting);
  const explicitRemote = (remoteType === "remote" || remoteType === "hybrid") && evidence.remote_type.explicit;
  const missingSourceJobId = !evidence.source_job_id.present;
  const missingParserKey = !evidence.parser_key.present;
  const missingParserVersion = !evidence.parser_version.present;
  const confidenceScore = Number(evidence.confidence_score.value || 0);
  const qualityScore = Number(evidence.quality_score.value || 0);

  if (missingSourceJobId) reasonCodes.push("missing_source_job_id");
  if (missingParserKey) reasonCodes.push("missing_parser_key");
  if (missingParserVersion) reasonCodes.push("missing_parser_version");
  if (qualityScore < thresholds.minQualityScore) reasonCodes.push("low_quality_score");
  if (confidenceScore < thresholds.minConfidenceScore) reasonCodes.push("low_parser_confidence");

  if (evidence.location_text.ambiguous && !(explicitRemote && (remoteType === "remote" || remoteType === "hybrid"))) {
    reasonCodes.push("ambiguous_location");
  }

  if (!usefulGeo && !explicitRemote) {
    reasonCodes.push("no_geo_no_remote");
  }
  if ((remoteType === "remote" || remoteType === "hybrid") && !explicitRemote) {
    reasonCodes.push("weak_remote_evidence");
  }

  let confidence = Number(evidence.confidence.value || 0.5);
  if (missingSourceJobId) confidence -= 0.1;
  if (missingParserKey || missingParserVersion) confidence -= 0.1;
  if (!evidence.posting_date.present) confidence -= 0.04;
  confidence = Math.max(0, Math.min(1, Number(confidence.toFixed(3))));

  if (reasonCodes.length > 0) {
    return {
      status: "quarantined",
      public: false,
      ok: false,
      reason_codes: Array.from(new Set(reasonCodes)),
      reason: Array.from(new Set(reasonCodes)).join(", "),
      evidence,
      retry_detail_refetch_eligible: true,
      confidence
    };
  }

  return {
    status: "accepted",
    public: true,
    ok: true,
    reason_codes: [],
    reason: "",
    evidence,
    retry_detail_refetch_eligible: false,
    confidence
  };
}

function validationFromGate(gateResult) {
  if (!gateResult || gateResult.status === "accepted") return { ok: true, status: "valid", error: "" };
  return {
    ok: false,
    status: gateResult.status,
    error: gateResult.reason || "non_public",
    reason_codes: gateResult.reason_codes || [],
    evidence: gateResult.evidence || {},
    retry_detail_refetch_eligible: Boolean(gateResult.retry_detail_refetch_eligible)
  };
}

module.exports = {
  buildEvidenceMetadata,
  evaluatePublicPosting,
  getPublicThresholds,
  hasExplicitRemoteEvidence,
  hasUsefulGeoEvidence,
  normalizeRemoteType,
  validationFromGate
};
