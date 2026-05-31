const {
  PARSER_FIXTURE_BACKED,
  getAdapterMetadata,
  getParserFixtureStatus
} = require("./adapter-metadata");

const SOURCE_QUALITY_STATES = Object.freeze({
  PUBLIC_ENABLED: "public_enabled",
  CANARY_ONLY: "canary_only",
  QUARANTINE_ONLY: "quarantine_only",
  DISABLED: "disabled"
});

const TIER_GROUPS = Object.freeze({
  DIRECT_JSON: new Set(["direct-json-stable"]),
  ENTERPRISE_DETAIL: new Set(["enterprise-direct", "vendor-specific", "brittle-high-risk"]),
  HTML_PUBLIC: new Set(["embedded-or-semi-structured", "public-sector-education"])
});

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asPercent(numerator, denominator) {
  const total = asNumber(denominator, 0);
  if (total <= 0) return 0;
  return Number(((asNumber(numerator, 0) / total) * 100).toFixed(2));
}

function readThresholds(env = process.env) {
  return {
    minRows: Math.max(10, Math.floor(asNumber(env.OPENJOBSLOTS_SOURCE_SLO_MIN_ROWS, 50))),
    directJsonAcceptedRateMinPct: Math.max(0, Math.min(100, asNumber(env.OPENJOBSLOTS_SOURCE_DIRECT_JSON_ACCEPTED_MIN_PCT, 85))),
    directJsonParserSuccessMinPct: Math.max(0, Math.min(100, asNumber(env.OPENJOBSLOTS_SOURCE_DIRECT_JSON_PARSER_SUCCESS_MIN_PCT, 95))),
    enterpriseAcceptedRateMinPct: Math.max(0, Math.min(100, asNumber(env.OPENJOBSLOTS_SOURCE_ENTERPRISE_ACCEPTED_MIN_PCT, 60))),
    enterpriseParserSuccessMinPct: Math.max(0, Math.min(100, asNumber(env.OPENJOBSLOTS_SOURCE_ENTERPRISE_PARSER_SUCCESS_MIN_PCT, 85))),
    htmlPublicAcceptedRateMinPct: Math.max(0, Math.min(100, asNumber(env.OPENJOBSLOTS_SOURCE_HTML_PUBLIC_ACCEPTED_MIN_PCT, 40))),
    htmlPublicParserSuccessMinPct: Math.max(0, Math.min(100, asNumber(env.OPENJOBSLOTS_SOURCE_HTML_PUBLIC_PARSER_SUCCESS_MIN_PCT, 75))),
    maxMissingAnyGeoPct: Math.max(1, asNumber(env.OPENJOBSLOTS_SOURCE_SLO_MAX_MISSING_ANY_GEO_PCT, 95)),
    maxMissingAllGeoUnknownRemotePct: Math.max(0, asNumber(env.OPENJOBSLOTS_SOURCE_SLO_MAX_MISSING_ALL_GEO_UNKNOWN_REMOTE_PCT, 5)),
    maxQuarantinePct: Math.max(1, asNumber(env.OPENJOBSLOTS_SOURCE_SLO_MAX_QUARANTINE_PCT, 70)),
    maxRejectedPct: Math.max(1, asNumber(env.OPENJOBSLOTS_SOURCE_SLO_MAX_REJECTED_PCT, 30)),
    maxMissingCountryPct: Math.max(1, asNumber(env.OPENJOBSLOTS_SOURCE_SLO_MAX_MISSING_COUNTRY_PCT, 95)),
    maxMissingCityPct: Math.max(1, asNumber(env.OPENJOBSLOTS_SOURCE_SLO_MAX_MISSING_CITY_PCT, 98)),
    maxUnknownRemotePct: Math.max(1, asNumber(env.OPENJOBSLOTS_SOURCE_SLO_MAX_UNKNOWN_REMOTE_PCT, 95)),
    maxParserFailurePct: Math.max(1, asNumber(env.OPENJOBSLOTS_SOURCE_SLO_MAX_PARSER_FAILURE_PCT, 50)),
    maxHttpFailurePct: Math.max(1, asNumber(env.OPENJOBSLOTS_SOURCE_SLO_MAX_HTTP_FAILURE_PCT, 50)),
    maxParserDriftPct: Math.max(1, asNumber(env.OPENJOBSLOTS_SOURCE_SLO_MAX_PARSER_DRIFT_PCT, 10)),
    parserFailureMinEvents: Math.max(1, Math.floor(asNumber(env.OPENJOBSLOTS_SOURCE_SLO_MIN_FAILURE_EVENTS, 10))),
    driftSimilarityThreshold: Math.max(0.1, Math.min(0.95, asNumber(env.OPENJOBSLOTS_PARSER_DRIFT_SIMILARITY, 0.55))),
    partialCanaryTargetsPerRun: Math.max(1, Math.floor(asNumber(env.OPENJOBSLOTS_PARTIAL_SOURCE_CANARY_TARGETS_PER_RUN, 5)))
  };
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function isCertifiedSource(atsKey) {
  return PARSER_FIXTURE_BACKED.has(String(atsKey || "").trim().toLowerCase());
}

function sourceFamilyFromTier(tier) {
  const normalized = String(tier || "").trim().toLowerCase();
  if (TIER_GROUPS.DIRECT_JSON.has(normalized)) return "direct_json";
  if (TIER_GROUPS.HTML_PUBLIC.has(normalized)) return "html_public_sector";
  if (TIER_GROUPS.ENTERPRISE_DETAIL.has(normalized)) return "enterprise_detail";
  return "enterprise_detail";
}

function familyThresholds(sourceFamily, thresholds = readThresholds()) {
  if (sourceFamily === "direct_json") {
    return {
      acceptedRateMinPct: thresholds.directJsonAcceptedRateMinPct,
      parserSuccessMinPct: thresholds.directJsonParserSuccessMinPct
    };
  }
  if (sourceFamily === "html_public_sector") {
    return {
      acceptedRateMinPct: thresholds.htmlPublicAcceptedRateMinPct,
      parserSuccessMinPct: thresholds.htmlPublicParserSuccessMinPct
    };
  }
  return {
    acceptedRateMinPct: thresholds.enterpriseAcceptedRateMinPct,
    parserSuccessMinPct: thresholds.enterpriseParserSuccessMinPct
  };
}

function policyFromState(state, reason, maxTargetsPerRun = Infinity) {
  const sourceQualityState = String(state || SOURCE_QUALITY_STATES.DISABLED);
  if (sourceQualityState === SOURCE_QUALITY_STATES.PUBLIC_ENABLED) {
    return {
      mode: "normal",
      source_quality_state: sourceQualityState,
      public_writes_allowed: true,
      diagnostics_only: false,
      maxTargetsPerRun,
      reason
    };
  }
  if (sourceQualityState === SOURCE_QUALITY_STATES.CANARY_ONLY) {
    return {
      mode: "canary",
      source_quality_state: sourceQualityState,
      public_writes_allowed: true,
      diagnostics_only: false,
      maxTargetsPerRun,
      reason
    };
  }
  if (sourceQualityState === SOURCE_QUALITY_STATES.QUARANTINE_ONLY) {
    return {
      mode: "quarantine_only",
      source_quality_state: sourceQualityState,
      public_writes_allowed: false,
      diagnostics_only: true,
      maxTargetsPerRun,
      reason
    };
  }
  return {
    mode: "disabled",
    source_quality_state: SOURCE_QUALITY_STATES.DISABLED,
    public_writes_allowed: false,
    diagnostics_only: true,
    maxTargetsPerRun: 0,
    reason
  };
}

function getSourceSyncPolicy(atsKey, options = {}) {
  const key = String(atsKey || "").trim().toLowerCase();
  const metadata = options.metadata || getAdapterMetadata(key);
  const protectionStatus = normalizeStatus(options.protectionStatus);
  if (protectionStatus === "disabled" || protectionStatus === "auto_disabled") {
    return policyFromState(SOURCE_QUALITY_STATES.DISABLED, options.disabledReason || "source disabled by quality policy", 0);
  }
  if (protectionStatus === "quarantine_only") {
    return policyFromState(
      SOURCE_QUALITY_STATES.QUARANTINE_ONLY,
      options.disabledReason || "source is quarantine-only",
      readThresholds().partialCanaryTargetsPerRun
    );
  }
  if (protectionStatus === "canary_only") {
    return policyFromState(
      SOURCE_QUALITY_STATES.CANARY_ONLY,
      options.disabledReason || "source is canary-only",
      readThresholds().partialCanaryTargetsPerRun
    );
  }
  const fixtureStatus = metadata?.parserFixtureStatus || getParserFixtureStatus(key);
  if (fixtureStatus === "parser-fixture-backed") {
    return policyFromState(SOURCE_QUALITY_STATES.PUBLIC_ENABLED, "parser-fixture-backed", Infinity);
  }
  if (fixtureStatus === "normalized-fixture-only" || fixtureStatus === "fixture-backed") {
    return policyFromState(
      SOURCE_QUALITY_STATES.CANARY_ONLY,
      "partial source canary budget",
      readThresholds().partialCanaryTargetsPerRun
    );
  }
  return policyFromState(
    SOURCE_QUALITY_STATES.DISABLED,
    "fallback or uncertified source is disabled until raw parser fixtures pass",
    0
  );
}

function summarizeSourceMetrics(row = {}) {
  const acceptedRows = asNumber(row.accepted_rows ?? row.accepted_count, 0);
  const quarantinedRows = asNumber(row.quarantined_rows ?? row.quarantined_count, 0);
  const rejectedRows = asNumber(row.rejected_rows ?? row.rejected_count, 0);
  const totalRows = acceptedRows + quarantinedRows + rejectedRows;
  const visibleRows = asNumber(row.visible_rows ?? row.total_visible_rows ?? acceptedRows, acceptedRows);
  const parserFailureEvents = asNumber(row.parser_failure_events, 0);
  const httpFailureEvents = asNumber(row.http_failure_events, 0);
  const driftEvents = asNumber(row.drift_events_24h ?? row.parser_drift_events, 0);
  const observedEvents = totalRows + parserFailureEvents + httpFailureEvents + driftEvents;
  const missingAnyGeoCount = asNumber(row.missing_any_geo_count, Math.max(
    asNumber(row.missing_country_count, 0),
    asNumber(row.missing_city_count, 0)
  ));
  const missingAllGeoUnknownRemoteCount = asNumber(row.missing_all_geo_unknown_remote_count, 0);
  const parserSuccessDenominator = totalRows + parserFailureEvents;
  return {
    ats_key: String(row.ats_key || row.source_ats || ""),
    accepted_rows: acceptedRows,
    quarantined_rows: quarantinedRows,
    rejected_rows: rejectedRows,
    total_rows: totalRows,
    visible_rows: visibleRows,
    missing_country_count: asNumber(row.missing_country_count, 0),
    missing_city_count: asNumber(row.missing_city_count, 0),
    missing_any_geo_count: missingAnyGeoCount,
    missing_all_geo_unknown_remote_count: missingAllGeoUnknownRemoteCount,
    unknown_remote_count: asNumber(row.unknown_remote_count, 0),
    parser_failure_events: parserFailureEvents,
    http_failure_events: httpFailureEvents,
    parser_drift_events: driftEvents,
    accepted_rate_pct: asPercent(acceptedRows, totalRows),
    parser_success_pct: parserSuccessDenominator > 0 ? Number((100 - asPercent(parserFailureEvents, parserSuccessDenominator)).toFixed(2)) : 100,
    quarantine_pct: asPercent(quarantinedRows, totalRows),
    rejected_pct: asPercent(rejectedRows, totalRows),
    missing_country_pct: asPercent(row.missing_country_count, visibleRows),
    missing_city_pct: asPercent(row.missing_city_count, visibleRows),
    missing_any_geo_pct: asPercent(missingAnyGeoCount, visibleRows),
    missing_all_geo_unknown_remote_pct: asPercent(missingAllGeoUnknownRemoteCount, visibleRows),
    unknown_remote_pct: asPercent(row.unknown_remote_count, visibleRows),
    parser_failure_pct: asPercent(parserFailureEvents, observedEvents),
    http_failure_pct: asPercent(httpFailureEvents, observedEvents),
    parser_drift_pct: asPercent(driftEvents, observedEvents)
  };
}

function classifySourceProtection(row = {}, options = {}) {
  const thresholds = { ...readThresholds(), ...(options.thresholds || {}) };
  const metrics = summarizeSourceMetrics(row);
  const metadata = options.metadata || getAdapterMetadata(metrics.ats_key);
  const sourceFamily = sourceFamilyFromTier(row.source_family || row.adapter_tier || metadata?.tier);
  const family = familyThresholds(sourceFamily, thresholds);
  const reasons = [];
  const disableReasons = [];
  const hasEnoughRows = metrics.total_rows >= thresholds.minRows;
  const visibleEnoughRows = metrics.visible_rows >= thresholds.minRows;
  if (hasEnoughRows && metrics.accepted_rate_pct < family.acceptedRateMinPct) {
    reasons.push(`accepted_rate_pct ${metrics.accepted_rate_pct}% < ${family.acceptedRateMinPct}% for ${sourceFamily}`);
  }
  if (hasEnoughRows && metrics.parser_success_pct < family.parserSuccessMinPct) {
    reasons.push(`parser_success_pct ${metrics.parser_success_pct}% < ${family.parserSuccessMinPct}% for ${sourceFamily}`);
  }
  if (hasEnoughRows && metrics.quarantine_pct >= thresholds.maxQuarantinePct) {
    reasons.push(`quarantine_pct ${metrics.quarantine_pct}% >= ${thresholds.maxQuarantinePct}%`);
  }
  if (hasEnoughRows && metrics.rejected_pct >= thresholds.maxRejectedPct) {
    reasons.push(`rejected_pct ${metrics.rejected_pct}% >= ${thresholds.maxRejectedPct}%`);
  }
  if (metrics.visible_rows >= thresholds.minRows &&
      metrics.missing_country_pct >= thresholds.maxMissingCountryPct &&
      metrics.unknown_remote_pct >= thresholds.maxUnknownRemotePct) {
    reasons.push(`missing_country_pct ${metrics.missing_country_pct}% and unknown_remote_pct ${metrics.unknown_remote_pct}% exceed limits`);
  }
  if (visibleEnoughRows &&
      metrics.missing_city_pct >= thresholds.maxMissingCityPct &&
      metrics.unknown_remote_pct >= thresholds.maxUnknownRemotePct) {
    reasons.push(`missing_city_pct ${metrics.missing_city_pct}% and unknown_remote_pct ${metrics.unknown_remote_pct}% exceed limits`);
  }
  if (visibleEnoughRows && metrics.missing_any_geo_pct >= thresholds.maxMissingAnyGeoPct) {
    reasons.push(`missing_any_geo_pct ${metrics.missing_any_geo_pct}% >= ${thresholds.maxMissingAnyGeoPct}%`);
  }
  if (visibleEnoughRows && metrics.missing_all_geo_unknown_remote_pct > thresholds.maxMissingAllGeoUnknownRemotePct) {
    reasons.push(`missing_all_geo_unknown_remote_pct ${metrics.missing_all_geo_unknown_remote_pct}% > ${thresholds.maxMissingAllGeoUnknownRemotePct}%`);
  }
  if (metrics.parser_failure_events >= thresholds.parserFailureMinEvents &&
      metrics.parser_failure_pct >= thresholds.maxParserFailurePct) {
    reasons.push(`parser_failure_pct ${metrics.parser_failure_pct}% >= ${thresholds.maxParserFailurePct}%`);
  }
  if (metrics.http_failure_events >= thresholds.parserFailureMinEvents &&
      metrics.http_failure_pct >= thresholds.maxHttpFailurePct) {
    disableReasons.push(`http_blocked: http_failure_pct ${metrics.http_failure_pct}% >= ${thresholds.maxHttpFailurePct}%`);
  }
  if (metrics.parser_drift_events >= thresholds.parserFailureMinEvents &&
      metrics.parser_drift_pct >= thresholds.maxParserDriftPct) {
    disableReasons.push(`parser_drift: parser_drift_pct ${metrics.parser_drift_pct}% >= ${thresholds.maxParserDriftPct}%`);
  }

  const action = disableReasons.length > 0
    ? "disable"
    : reasons.length > 0
      ? "quarantine_only"
      : "none";
  const sourceQualityState = action === "disable"
    ? SOURCE_QUALITY_STATES.DISABLED
    : action === "quarantine_only"
      ? SOURCE_QUALITY_STATES.QUARANTINE_ONLY
      : getSourceSyncPolicy(metrics.ats_key, {
          metadata,
          protectionStatus: row.protection_status,
          disabledReason: row.disabled_reason
        }).source_quality_state;
  const allReasons = [...disableReasons, ...reasons];
  return {
    action,
    protection_status: action === "disable"
      ? "auto_disabled"
      : action === "quarantine_only"
        ? "quarantine_only"
        : (sourceQualityState === SOURCE_QUALITY_STATES.CANARY_ONLY ? "canary_only" : "normal"),
    source_quality_state: sourceQualityState,
    reason: allReasons.join("; "),
    metrics,
    thresholds,
    source_family: sourceFamily,
    family_thresholds: family
  };
}

function valueType(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function collectShapePaths(value, prefix = "", paths = new Set(), depth = 0) {
  if (depth > 5) return paths;
  const type = valueType(value);
  if (prefix) paths.add(`${prefix}:${type}`);
  if (Array.isArray(value)) {
    if (value.length === 0) {
      if (prefix) paths.add(`${prefix}[]:empty`);
      return paths;
    }
    collectShapePaths(value[0], `${prefix}[]`, paths, depth + 1);
    return paths;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort().slice(0, 100);
    for (const key of keys) {
      collectShapePaths(value[key], prefix ? `${prefix}.${key}` : key, paths, depth + 1);
    }
  }
  return paths;
}

function analyzePayloadShape(payload) {
  const paths = Array.from(collectShapePaths(payload)).sort();
  const crypto = require("crypto");
  const shapeHash = crypto.createHash("sha256").update(paths.join("\n")).digest("hex").slice(0, 24);
  return { shape_hash: shapeHash, shape_paths: paths };
}

const DYNAMIC_DETAIL_MAP_KEYS = Object.freeze([
  "__detailHtmlByUrl",
  "detailHtmlByUrl",
  "__detailStatusByUrl",
  "detailStatusByUrl",
  "__detailFailureByUrl",
  "detailFailureByUrl"
]);

function normalizeDynamicDetailShapePath(path) {
  const source = String(path || "");
  const typeSeparator = source.lastIndexOf(":");
  if (typeSeparator <= 0) return source;
  const stem = source.slice(0, typeSeparator);
  const type = source.slice(typeSeparator + 1);
  for (const key of DYNAMIC_DETAIL_MAP_KEYS) {
    if (stem.startsWith(`${key}.`)) {
      return `${key}.*:${type}`;
    }
    const nestedMarker = `.${key}.`;
    const nestedIndex = stem.indexOf(nestedMarker);
    if (nestedIndex >= 0) {
      return `${stem.slice(0, nestedIndex + 1)}${key}.*:${type}`;
    }
  }
  return source;
}

function normalizeShapePathsForDrift(paths = []) {
  return Array.from(new Set((Array.isArray(paths) ? paths : []).map(normalizeDynamicDetailShapePath))).sort();
}

function shapeSimilarity(aPaths = [], bPaths = []) {
  const a = new Set(Array.isArray(aPaths) ? aPaths : []);
  const b = new Set(Array.isArray(bPaths) ? bPaths : []);
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const path of a) {
    if (b.has(path)) intersection += 1;
  }
  const union = new Set([...a, ...b]).size;
  return union <= 0 ? 0 : Number((intersection / union).toFixed(4));
}

function detectParserDrift(baselineShape, observedShape, options = {}) {
  if (!baselineShape || !Array.isArray(baselineShape.shape_paths)) {
    return { drift: false, similarity: 1, reason: "no-baseline" };
  }
  const similarity = shapeSimilarity(
    normalizeShapePathsForDrift(baselineShape.shape_paths),
    normalizeShapePathsForDrift(observedShape?.shape_paths || [])
  );
  const threshold = asNumber(options.threshold, readThresholds().driftSimilarityThreshold);
  return {
    drift: similarity < threshold,
    similarity,
    threshold,
    reason: similarity < threshold ? `payload shape similarity ${similarity} below ${threshold}` : ""
  };
}

module.exports = {
  analyzePayloadShape,
  classifySourceProtection,
  detectParserDrift,
  familyThresholds,
  getSourceSyncPolicy,
  isCertifiedSource,
  normalizeShapePathsForDrift,
  readThresholds,
  shapeSimilarity,
  sourceFamilyFromTier,
  SOURCE_QUALITY_STATES,
  summarizeSourceMetrics
};
