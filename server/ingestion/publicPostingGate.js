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
  return asString(posting.parser_version || posting.parser_key || "unknown");
}

function getParserKey(posting = {}) {
  return asString(posting.parser_key || posting.ats_key || posting.source_ats || posting.ats || "unknown").toLowerCase();
}

function getConfidence(posting = {}) {
  return asNumber(posting.parser_confidence ?? posting.confidence ?? posting.confidence_score, 0.5);
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

function locationLooksAmbiguous(locationText, posting = {}) {
  const location = asLower(locationText);
  if (!location) return false;
  if (AMBIGUOUS_LOCATION_VALUES.has(location)) return true;
  if (/^(multiple|various)\b/.test(location)) return true;
  if (/\b(multiple|various) locations?\b/.test(location)) return true;
  const country = asLower(posting.country);
  const region = asLower(posting.region || posting.state);
  const city = asLower(posting.city);
  if (!country && !city && !region && AMBIGUOUS_COUNTRY_CODES.has(location)) return true;
  return false;
}

function hasConcreteLocationText(locationText) {
  const location = asLower(locationText);
  if (!location || AMBIGUOUS_LOCATION_VALUES.has(location)) return false;
  if (/^(multiple|various)\b/.test(location)) return false;
  if (/\b(remote|anywhere|worldwide|global|work from home|wfh)\b/.test(location)) return false;
  return true;
}

function hasUsefulGeoEvidence(posting = {}) {
  if (hasValue(posting.country) || hasValue(posting.region || posting.state) || hasValue(posting.city)) return true;
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
  const locationText = getLocationText(posting);
  const remoteType = normalizeRemoteType(posting.remote_type);
  const confidence = Math.max(0, Math.min(1, getConfidence(posting)));
  const sourceJobId = asString(posting.source_job_id || posting.job_id || posting.id);
  return {
    title: createEvidence(getTitle(posting), "normalized_title"),
    company: createEvidence(getCompany(posting), "normalized_company"),
    canonical_url: createEvidence(getCanonicalUrl(posting), "canonical_url"),
    source_job_id: createEvidence(sourceJobId, "source_payload"),
    location_text: createEvidence(locationText, "source_location_text", {
      ambiguous: locationLooksAmbiguous(locationText, posting)
    }),
    country: createEvidence(posting.country, "normalized_country"),
    region: createEvidence(posting.region || posting.state, "normalized_region"),
    city: createEvidence(posting.city, "normalized_city"),
    remote_type: createEvidence(remoteType === "unknown" ? "" : remoteType, "normalized_remote_type", {
      normalized: remoteType,
      explicit: hasExplicitRemoteEvidence({ ...posting, remote_type: remoteType })
    }),
    posting_date: createEvidence(posting.posted_at || posting.posting_date || posting.posted_at_epoch || posting.posting_date_epoch, "source_posting_date"),
    parser_key: createEvidence(getParserKey(posting), "parser"),
    parser_version: createEvidence(options.parserVersion || getParserVersion(posting), "parser"),
    confidence: {
      present: true,
      value: confidence,
      source: "parser_confidence"
    }
  };
}

function evaluatePublicPosting(posting = {}, options = {}) {
  const evidence = buildEvidenceMetadata(posting, options);
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
  const explicitRemote = remoteType !== "unknown" && evidence.remote_type.explicit;
  if (evidence.location_text.ambiguous && !(explicitRemote && (remoteType === "remote" || remoteType === "hybrid"))) {
    reasonCodes.push("ambiguous_geo");
  }

  if (!usefulGeo && remoteType === "unknown") {
    reasonCodes.push("no_geo_unknown_remote");
  }
  if ((remoteType === "remote" || remoteType === "hybrid") && !explicitRemote) {
    reasonCodes.push("weak_remote_evidence");
  }

  const missingSourceJobId = !evidence.source_job_id.present;
  let confidence = Number(evidence.confidence.value || 0.5);
  if (missingSourceJobId) confidence -= 0.1;
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
    reason_codes: missingSourceJobId ? ["missing_source_job_id"] : [],
    reason: missingSourceJobId ? "missing_source_job_id" : "",
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
  hasExplicitRemoteEvidence,
  hasUsefulGeoEvidence,
  normalizeRemoteType,
  validationFromGate
};
