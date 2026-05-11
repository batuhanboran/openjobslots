const {
  PARSER_FIXTURE_BACKED,
  getAdapterMetadata,
  getParserFixtureStatus
} = require("./adapter-metadata");

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
    maxQuarantinePct: Math.max(1, asNumber(env.OPENJOBSLOTS_SOURCE_SLO_MAX_QUARANTINE_PCT, 70)),
    maxRejectedPct: Math.max(1, asNumber(env.OPENJOBSLOTS_SOURCE_SLO_MAX_REJECTED_PCT, 30)),
    maxMissingCountryPct: Math.max(1, asNumber(env.OPENJOBSLOTS_SOURCE_SLO_MAX_MISSING_COUNTRY_PCT, 95)),
    maxMissingCityPct: Math.max(1, asNumber(env.OPENJOBSLOTS_SOURCE_SLO_MAX_MISSING_CITY_PCT, 98)),
    maxUnknownRemotePct: Math.max(1, asNumber(env.OPENJOBSLOTS_SOURCE_SLO_MAX_UNKNOWN_REMOTE_PCT, 95)),
    maxParserFailurePct: Math.max(1, asNumber(env.OPENJOBSLOTS_SOURCE_SLO_MAX_PARSER_FAILURE_PCT, 50)),
    maxHttpFailurePct: Math.max(1, asNumber(env.OPENJOBSLOTS_SOURCE_SLO_MAX_HTTP_FAILURE_PCT, 50)),
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

function getSourceSyncPolicy(atsKey, options = {}) {
  const key = String(atsKey || "").trim().toLowerCase();
  const metadata = options.metadata || getAdapterMetadata(key);
  const protectionStatus = normalizeStatus(options.protectionStatus);
  if (protectionStatus === "disabled" || protectionStatus === "auto_disabled") {
    return {
      mode: "disabled",
      maxTargetsPerRun: 0,
      reason: options.disabledReason || "source disabled by quality policy"
    };
  }
  if (protectionStatus === "quarantine_only") {
    return {
      mode: "quarantine_only",
      maxTargetsPerRun: readThresholds().partialCanaryTargetsPerRun,
      reason: options.disabledReason || "source is quarantine-only"
    };
  }
  const fixtureStatus = metadata?.parserFixtureStatus || getParserFixtureStatus(key);
  if (fixtureStatus === "parser-fixture-backed") {
    return { mode: "normal", maxTargetsPerRun: Infinity, reason: "parser-fixture-backed" };
  }
  if (fixtureStatus === "normalized-fixture-only" || fixtureStatus === "fixture-backed") {
    return {
      mode: "canary",
      maxTargetsPerRun: readThresholds().partialCanaryTargetsPerRun,
      reason: "partial source canary budget"
    };
  }
  return {
    mode: "disabled",
    maxTargetsPerRun: 0,
    reason: "fallback or uncertified source is disabled until raw parser fixtures pass"
  };
}

function summarizeSourceMetrics(row = {}) {
  const acceptedRows = asNumber(row.accepted_rows ?? row.accepted_count, 0);
  const quarantinedRows = asNumber(row.quarantined_rows ?? row.quarantined_count, 0);
  const rejectedRows = asNumber(row.rejected_rows ?? row.rejected_count, 0);
  const totalRows = acceptedRows + quarantinedRows + rejectedRows;
  const visibleRows = asNumber(row.visible_rows ?? row.total_visible_rows ?? acceptedRows, acceptedRows);
  const parserFailureEvents = asNumber(row.parser_failure_events, 0);
  const httpFailureEvents = asNumber(row.http_failure_events, 0);
  const observedEvents = totalRows + parserFailureEvents + httpFailureEvents;
  return {
    ats_key: String(row.ats_key || row.source_ats || ""),
    accepted_rows: acceptedRows,
    quarantined_rows: quarantinedRows,
    rejected_rows: rejectedRows,
    total_rows: totalRows,
    visible_rows: visibleRows,
    missing_country_count: asNumber(row.missing_country_count, 0),
    missing_city_count: asNumber(row.missing_city_count, 0),
    unknown_remote_count: asNumber(row.unknown_remote_count, 0),
    parser_failure_events: parserFailureEvents,
    http_failure_events: httpFailureEvents,
    quarantine_pct: asPercent(quarantinedRows, totalRows),
    rejected_pct: asPercent(rejectedRows, totalRows),
    missing_country_pct: asPercent(row.missing_country_count, visibleRows),
    missing_city_pct: asPercent(row.missing_city_count, visibleRows),
    unknown_remote_pct: asPercent(row.unknown_remote_count, visibleRows),
    parser_failure_pct: asPercent(parserFailureEvents, observedEvents),
    http_failure_pct: asPercent(httpFailureEvents, observedEvents)
  };
}

function classifySourceProtection(row = {}, options = {}) {
  const thresholds = { ...readThresholds(), ...(options.thresholds || {}) };
  const metrics = summarizeSourceMetrics(row);
  const reasons = [];
  const hasEnoughRows = metrics.total_rows >= thresholds.minRows;
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
  if (metrics.visible_rows >= thresholds.minRows &&
      metrics.missing_city_pct >= thresholds.maxMissingCityPct &&
      metrics.unknown_remote_pct >= thresholds.maxUnknownRemotePct) {
    reasons.push(`missing_city_pct ${metrics.missing_city_pct}% and unknown_remote_pct ${metrics.unknown_remote_pct}% exceed limits`);
  }
  if (metrics.parser_failure_events >= thresholds.parserFailureMinEvents &&
      metrics.parser_failure_pct >= thresholds.maxParserFailurePct) {
    reasons.push(`parser_failure_pct ${metrics.parser_failure_pct}% >= ${thresholds.maxParserFailurePct}%`);
  }
  if (metrics.http_failure_events >= thresholds.parserFailureMinEvents &&
      metrics.http_failure_pct >= thresholds.maxHttpFailurePct) {
    reasons.push(`http_failure_pct ${metrics.http_failure_pct}% >= ${thresholds.maxHttpFailurePct}%`);
  }
  return {
    action: reasons.length > 0 ? "disable" : "none",
    protection_status: reasons.length > 0 ? "auto_disabled" : "normal",
    reason: reasons.join("; "),
    metrics,
    thresholds
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
  const similarity = shapeSimilarity(baselineShape.shape_paths, observedShape?.shape_paths || []);
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
  getSourceSyncPolicy,
  isCertifiedSource,
  readThresholds,
  shapeSimilarity,
  summarizeSourceMetrics
};
