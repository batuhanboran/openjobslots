const fs = require("node:fs");
const path = require("node:path");
const { createPostgresPool } = require("../backends/postgres");
const { acquireHeavyJobLock } = require("../backends/heavyJobLock");
const { normalizeAtsKey } = require("../backends/postgresStore");
const { canonicalizePostingUrl } = require("./posting");
const {
  MAX_RUN_LIMIT,
  DEFAULT_SOURCE_RUN_LIMIT,
  discoverSourceTargets,
  evaluateSourceCandidate,
  runWithLimitedConcurrency
} = require("./sourceRunner");

const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const MAX_RUN_OFFSET = 1_000_000;
const MAX_CONCURRENCY = 4;

const ESTIMATE_CLASSIFICATIONS = Object.freeze([
  "net_new_clean_public_candidate",
  "already_public_same_source_job_id",
  "already_public_same_canonical_url",
  "already_indexable_duplicate",
  "existing_public_update_candidate",
  "stale_or_hidden_reactivation_candidate",
  "quarantine_candidate",
  "rejected_candidate",
  "no_geo_no_remote",
  "ambiguous_location",
  "parser_failure",
  "source_fetch_failure",
  "runner_limit_cap_unproven_inventory"
]);

function nowIso() {
  return new Date().toISOString();
}

function asInt(value, fallback, min, max) {
  const parsed = Number(value);
  const number = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  return Math.max(min, Math.min(max, number));
}

function asBool(value) {
  return ["1", "true", "yes", "y", "on"].includes(String(value || "").trim().toLowerCase());
}

function clean(value, max = 1000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function isPresent(value) {
  const normalized = clean(value).toLowerCase();
  return Boolean(normalized && !["unknown", "n/a", "na", "none", "null", "undefined"].includes(normalized));
}

function incrementCounter(map, key, amount = 1) {
  const normalized = String(key || "unknown");
  map[normalized] = Number(map[normalized] || 0) + Number(amount || 0);
}

function pct(numerator, denominator) {
  if (!denominator) return 0;
  return Number(((Number(numerator || 0) / Number(denominator || 1)) * 100).toFixed(2));
}

function remoteType(value) {
  const normalized = clean(value).toLowerCase().replace(/[_\s]+/g, "-");
  if (["remote", "hybrid", "onsite"].includes(normalized)) return normalized;
  if (["on-site", "on-site-only", "non-remote"].includes(normalized)) return "onsite";
  return "unknown";
}

function getCanonicalUrl(posting = {}) {
  return clean(posting.canonical_url || posting.job_posting_url || posting.source_url);
}

function getApplyUrl(posting = {}) {
  return clean(posting.apply_url);
}

function getSourceJobId(posting = {}) {
  return clean(posting.source_job_id || posting.source_derived_id || posting.stable_source_id || posting.job_id || posting.id, 500);
}

function normalizedUrl(value) {
  return canonicalizePostingUrl(value);
}

function urlKeysForPosting(posting = {}) {
  return Array.from(new Set([
    getCanonicalUrl(posting),
    normalizedUrl(getCanonicalUrl(posting)),
    getApplyUrl(posting),
    normalizedUrl(getApplyUrl(posting))
  ].map((value) => clean(value, 2000)).filter(Boolean)));
}

function sourceJobKey(source, sourceJobId) {
  const id = clean(sourceJobId, 500);
  return id ? `${normalizeAtsKey(source)}\u0000${id}` : "";
}

function rowFromExisting(value = {}) {
  return {
    canonical_url: clean(value.canonical_url, 2000),
    apply_url: clean(value.apply_url, 2000),
    ats_key: normalizeAtsKey(value.ats_key),
    source_job_id: clean(value.source_job_id, 500),
    hidden: value.hidden === true || value.hidden === "true",
    city: clean(value.city),
    country: clean(value.country),
    region: clean(value.region),
    location_text: clean(value.location_text),
    remote_type: remoteType(value.remote_type),
    position_name: clean(value.position_name),
    company_name: clean(value.company_name)
  };
}

function buildExistingLookup(existingRows = []) {
  const lookup = {
    byCanonical: new Map(),
    byNormalizedUrl: new Map(),
    bySameSourceJobId: new Map(),
    byGlobalSourceJobId: new Map()
  };
  for (const rawRow of Array.isArray(existingRows) ? existingRows : []) {
    const row = rowFromExisting(rawRow);
    for (const key of [row.canonical_url, row.apply_url].filter(Boolean)) {
      if (!lookup.byCanonical.has(key)) lookup.byCanonical.set(key, []);
      lookup.byCanonical.get(key).push(row);
      const normalized = normalizedUrl(key);
      if (normalized) {
        if (!lookup.byNormalizedUrl.has(normalized)) lookup.byNormalizedUrl.set(normalized, []);
        lookup.byNormalizedUrl.get(normalized).push(row);
      }
    }
    if (row.source_job_id) {
      const sameSourceKey = sourceJobKey(row.ats_key, row.source_job_id);
      if (!lookup.bySameSourceJobId.has(sameSourceKey)) lookup.bySameSourceJobId.set(sameSourceKey, []);
      lookup.bySameSourceJobId.get(sameSourceKey).push(row);
      if (!lookup.byGlobalSourceJobId.has(row.source_job_id)) lookup.byGlobalSourceJobId.set(row.source_job_id, []);
      lookup.byGlobalSourceJobId.get(row.source_job_id).push(row);
    }
  }
  return lookup;
}

function uniqueRows(rows = []) {
  const seen = new Set();
  const output = [];
  for (const row of rows) {
    const key = `${row.ats_key}\u0000${row.source_job_id}\u0000${row.canonical_url}\u0000${row.hidden}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(row);
  }
  return output;
}

function candidateHasQualityUpdate(candidate = {}, existing = {}) {
  const improvements = [
    ["country", candidate.country, existing.country],
    ["region", candidate.region || candidate.state, existing.region],
    ["city", candidate.city, existing.city],
    ["location_text", candidate.location_text || candidate.location, existing.location_text],
    ["source_job_id", getSourceJobId(candidate), existing.source_job_id]
  ];
  if (remoteType(existing.remote_type) === "unknown" && remoteType(candidate.remote_type) !== "unknown") {
    return true;
  }
  return improvements.some(([, nextValue, currentValue]) => isPresent(nextValue) && !isPresent(currentValue));
}

function candidateQualityRisk(candidate = {}) {
  const missingCountry = !isPresent(candidate.country);
  const missingRegion = !isPresent(candidate.region || candidate.state);
  const missingCity = !isPresent(candidate.city);
  const missingAnyGeo = missingCountry || missingRegion || missingCity;
  const missingAllGeo = missingCountry && missingRegion && missingCity;
  const weakUnknownRemote = remoteType(candidate.remote_type) === "unknown";
  return {
    missing_country: missingCountry,
    missing_region: missingRegion,
    missing_city: missingCity,
    missing_any_geo: missingAnyGeo,
    missing_all_geo: missingAllGeo,
    weak_unknown_remote: weakUnknownRemote,
    no_geo_no_remote: missingAllGeo && weakUnknownRemote
  };
}

function classifyNonAccepted(status, validation = {}) {
  const reasonCodes = Array.isArray(validation.reason_codes) ? validation.reason_codes.map(clean) : [];
  const reason = clean(validation.error || validation.reason || reasonCodes.join(", "));
  if (reasonCodes.includes("no_geo_no_remote") || reason === "no_geo_no_remote") return "no_geo_no_remote";
  if (reasonCodes.includes("ambiguous_location") || reason === "ambiguous_location") return "ambiguous_location";
  if (status === "rejected") return "rejected_candidate";
  return "quarantine_candidate";
}

function classifyCandidateAgainstExisting(candidate = {}, existingLookup = buildExistingLookup([]), seen = {}) {
  const source = normalizeAtsKey(candidate.ats_key || candidate.source_ats);
  const canonicalUrl = getCanonicalUrl(candidate);
  const candidateSourceJobId = getSourceJobId(candidate);
  const sourceKey = sourceJobKey(source, candidateSourceJobId);
  const urlKeys = urlKeysForPosting(candidate);
  const seenSourceKeys = seen.sourceJobKeys || new Set();
  const seenUrlKeys = seen.urlKeys || new Set();
  if (sourceKey && seenSourceKeys.has(sourceKey)) {
    return {
      classification: "already_indexable_duplicate",
      reason: "duplicate_candidate_same_source_job_id_in_estimate",
      matched_by: "candidate_batch_source_job_id"
    };
  }
  const firstSeenUrl = urlKeys.find((key) => seenUrlKeys.has(key));
  if (firstSeenUrl) {
    return {
      classification: "already_indexable_duplicate",
      reason: "duplicate_candidate_same_canonical_url_in_estimate",
      matched_by: "candidate_batch_canonical_url",
      matched_value: firstSeenUrl
    };
  }

  const sourceJobMatches = sourceKey ? (existingLookup.bySameSourceJobId.get(sourceKey) || []) : [];
  const canonicalMatches = uniqueRows(urlKeys.flatMap((key) => existingLookup.byCanonical.get(key) || []));
  const normalizedMatches = uniqueRows(urlKeys.flatMap((key) => existingLookup.byNormalizedUrl.get(normalizedUrl(key)) || []));
  const allMatches = uniqueRows([...sourceJobMatches, ...canonicalMatches, ...normalizedMatches]);
  const publicMatches = allMatches.filter((row) => !row.hidden);
  const hiddenMatches = allMatches.filter((row) => row.hidden);

  if (publicMatches.length === 0 && hiddenMatches.length > 0) {
    return {
      classification: "stale_or_hidden_reactivation_candidate",
      reason: "matched_existing_hidden_or_stale_posting",
      matched_by: "hidden_existing_row",
      matched_canonical_url: hiddenMatches[0].canonical_url
    };
  }

  const updateMatch = publicMatches.find((row) => candidateHasQualityUpdate(candidate, row));
  if (updateMatch) {
    return {
      classification: "existing_public_update_candidate",
      reason: "candidate_can_update_existing_public_row_without_net_new_gain",
      matched_by: "existing_public_row",
      matched_canonical_url: updateMatch.canonical_url
    };
  }

  const sameSourceJob = sourceJobMatches.find((row) => !row.hidden);
  if (sameSourceJob) {
    return {
      classification: "already_public_same_source_job_id",
      reason: "same_source_and_source_job_id_already_public",
      matched_by: "source_ats_source_job_id",
      matched_canonical_url: sameSourceJob.canonical_url
    };
  }

  const sameCanonical = canonicalMatches.find((row) => !row.hidden);
  if (sameCanonical) {
    return {
      classification: "already_public_same_canonical_url",
      reason: "canonical_or_apply_url_already_public",
      matched_by: "canonical_url_or_apply_url",
      matched_canonical_url: sameCanonical.canonical_url
    };
  }

  const normalizedDuplicate = normalizedMatches.find((row) => !row.hidden);
  if (normalizedDuplicate) {
    return {
      classification: "already_indexable_duplicate",
      reason: "normalized_canonical_or_apply_url_already_indexable",
      matched_by: "normalized_canonical_or_apply_url",
      matched_canonical_url: normalizedDuplicate.canonical_url
    };
  }

  return {
    classification: "net_new_clean_public_candidate",
    reason: "accepted_candidate_not_found_in_existing_public_rows",
    matched_by: ""
  };
}

function markCandidateSeen(candidate = {}, seen = {}) {
  if (!seen.sourceJobKeys) seen.sourceJobKeys = new Set();
  if (!seen.urlKeys) seen.urlKeys = new Set();
  const sourceKey = sourceJobKey(candidate.ats_key || candidate.source_ats, getSourceJobId(candidate));
  if (sourceKey) seen.sourceJobKeys.add(sourceKey);
  for (const key of urlKeysForPosting(candidate)) seen.urlKeys.add(key);
}

function createEmptyClassificationCounts() {
  return Object.fromEntries(ESTIMATE_CLASSIFICATIONS.map((key) => [key, 0]));
}

function summarizeInventory({ configuredTargets, targetsScanned, requestedLimit, effectiveLimit, offset }) {
  const configured = Math.max(0, Number(configuredTargets || 0));
  const scanned = Math.max(0, Number(targetsScanned || 0));
  const startOffset = Math.max(0, Number(offset || 0));
  const remaining = Math.max(0, configured - startOffset - scanned);
  const limitCapped = Number(requestedLimit || 0) > Number(effectiveLimit || 0);
  return {
    configured_targets: configured,
    targets_scanned: scanned,
    targets_remaining_unscanned: remaining,
    requested_limit: Number(requestedLimit || 0),
    effective_limit: Number(effectiveLimit || 0),
    offset: startOffset,
    target_coverage_pct: pct(scanned, configured),
    limit_capped: limitCapped,
    offset_resume_supported: true,
    cannot_prove_remaining_inventory: remaining > 0,
    runner_limit_cap_unproven_inventory: limitCapped && remaining > 0
  };
}

async function countConfiguredTargets(pool, source, options = {}) {
  const enabledFilter = options.includeDisabled
    ? ""
    : "AND s.enabled = true AND COALESCE(NULLIF(s.protection_status, ''), 'normal') NOT IN ('disabled', 'auto_disabled')";
  const result = await pool.query(
    `
      SELECT COUNT(*)::int AS count
      FROM companies c
      INNER JOIN ats_sources s ON s.ats_key = c.ats_key
      WHERE c.ats_key = $1
        ${enabledFilter};
    `,
    [normalizeAtsKey(source)]
  );
  return Number(result.rows[0]?.count || 0);
}

async function getExistingRowsForCandidates(pool, source, candidates = []) {
  const sourceJobIds = Array.from(new Set(candidates.map(getSourceJobId).filter(Boolean)));
  const urls = Array.from(new Set(candidates.flatMap(urlKeysForPosting).filter(Boolean)));
  const result = await pool.query(
    `
      SELECT canonical_url, apply_url, ats_key, source_job_id, hidden, city, country, region,
             location_text, remote_type, position_name, company_name
      FROM postings
      WHERE ats_key = $1
         OR ($2::text[] <> '{}'::text[] AND source_job_id = ANY($2::text[]))
         OR ($3::text[] <> '{}'::text[] AND (canonical_url = ANY($3::text[]) OR apply_url = ANY($3::text[])));
    `,
    [normalizeAtsKey(source), sourceJobIds, urls]
  );
  return result.rows.map(rowFromExisting);
}

function createBaseReport(options = {}) {
  return {
    ok: true,
    generated_at: nowIso(),
    source: normalizeAtsKey(options.source),
    requested_limit: Number(options.requestedLimit || options.limit || DEFAULT_SOURCE_RUN_LIMIT),
    effective_limit: Number(options.limit || DEFAULT_SOURCE_RUN_LIMIT),
    offset: Number(options.offset || 0),
    mode: "estimate-net-new",
    read_only: true,
    classifications: createEmptyClassificationCounts(),
    parser_failure_reasons: {},
    http_status_counts: {},
    errors: [],
    samples: [],
    rows_fetched: 0,
    rows_parsed: 0,
    clean_candidates: 0,
    net_new_clean_public_candidates: 0,
    already_public_duplicates: 0,
    existing_public_update_candidates: 0,
    stale_or_hidden_reactivation_candidates: 0,
    quarantine_candidates: 0,
    rejected_candidates: 0,
    expected_public_row_gain: 0,
    quality_risk_of_net_new_rows: {
      missing_country: 0,
      missing_region: 0,
      missing_city: 0,
      missing_any_geo: 0,
      missing_all_geo: 0,
      weak_unknown_remote: 0,
      no_geo_no_remote: 0
    },
    meili_comparison: {
      skipped: true,
      reason: "optional Meili duplicate comparison was not requested; Postgres remains source of truth"
    }
  };
}

function recordSample(report, target, candidate, classification, reason) {
  if (report.samples.length >= 25) return;
  report.samples.push({
    source_url: clean(target?.companyUrl || ""),
    canonical_url: getCanonicalUrl(candidate),
    source_job_id: getSourceJobId(candidate),
    title: clean(candidate?.position_name || candidate?.title || ""),
    classification,
    reason: clean(reason, 300)
  });
}

function extractHttpStatus(error) {
  const explicit = Number(error?.status || error?.statusCode || error?.httpStatus || error?.response?.status || 0);
  if (Number.isFinite(explicit) && explicit >= 100 && explicit <= 599) return explicit;
  const match = String(error?.message || error || "").match(/\b([1-5][0-9]{2})\b/);
  const parsed = match ? Number(match[1]) : 0;
  return Number.isFinite(parsed) && parsed >= 100 && parsed <= 599 ? parsed : null;
}

async function collectCandidates(pool, targets = [], options = {}, report = createBaseReport(options)) {
  const nowEpoch = Math.floor(Date.now() / 1000);
  const acceptedCandidates = [];
  await runWithLimitedConcurrency(
    targets,
    async (target) => {
      let raw;
      try {
        raw = await target.adapter.fetch(target.company);
        report.rows_fetched += 1;
      } catch (error) {
        const httpStatus = extractHttpStatus(error);
        if (httpStatus) incrementCounter(report.http_status_counts, httpStatus);
        incrementCounter(report.parser_failure_reasons, error?.ingestionErrorType || "source_fetch_failure");
        incrementCounter(report.classifications, "source_fetch_failure");
        report.errors.push({ source_url: target.companyUrl, error: clean(error?.message || error, 300) });
        return;
      }

      let parsed;
      try {
        parsed = target.adapter.parse(raw, target.company);
      } catch (error) {
        incrementCounter(report.parser_failure_reasons, "parser_failure");
        incrementCounter(report.classifications, "parser_failure");
        report.errors.push({ source_url: target.companyUrl, error: clean(error?.message || error, 300) });
        return;
      }
      const rows = Array.isArray(parsed) ? parsed : [];
      report.rows_parsed += rows.length;
      for (const item of rows) {
        let evaluated;
        try {
          evaluated = evaluateSourceCandidate(target, item, { nowEpoch });
        } catch (error) {
          incrementCounter(report.parser_failure_reasons, "parser_failure");
          incrementCounter(report.classifications, "parser_failure");
          recordSample(report, target, {}, "parser_failure", error?.message || error);
          continue;
        }
        const { normalized, status, validation } = evaluated;
        if (status !== "accepted") {
          const classification = classifyNonAccepted(status, validation);
          incrementCounter(report.classifications, classification);
          if (classification === "rejected_candidate") report.rejected_candidates += 1;
          else report.quarantine_candidates += 1;
          incrementCounter(report.parser_failure_reasons, validation?.error || classification);
          recordSample(report, target, normalized, classification, validation?.error || classification);
          continue;
        }
        report.clean_candidates += 1;
        acceptedCandidates.push({ target, candidate: normalized });
      }
    },
    options
  );
  return acceptedCandidates;
}

async function classifyAcceptedCandidates(pool, source, acceptedCandidates = [], report = createBaseReport({ source })) {
  const existingRows = await getExistingRowsForCandidates(pool, source, acceptedCandidates.map((item) => item.candidate));
  const lookup = buildExistingLookup(existingRows);
  const seen = { sourceJobKeys: new Set(), urlKeys: new Set() };
  for (const item of acceptedCandidates) {
    const candidate = item.candidate;
    const result = classifyCandidateAgainstExisting(candidate, lookup, seen);
    incrementCounter(report.classifications, result.classification);
    if (result.classification === "net_new_clean_public_candidate") {
      report.net_new_clean_public_candidates += 1;
      report.expected_public_row_gain += 1;
      const risk = candidateQualityRisk(candidate);
      for (const [key, value] of Object.entries(risk)) {
        if (value) report.quality_risk_of_net_new_rows[key] += 1;
      }
      markCandidateSeen(candidate, seen);
    } else if ([
      "already_public_same_source_job_id",
      "already_public_same_canonical_url",
      "already_indexable_duplicate"
    ].includes(result.classification)) {
      report.already_public_duplicates += 1;
    } else if (result.classification === "existing_public_update_candidate") {
      report.existing_public_update_candidates += 1;
    } else if (result.classification === "stale_or_hidden_reactivation_candidate") {
      report.stale_or_hidden_reactivation_candidates += 1;
    }
    recordSample(report, item.target, candidate, result.classification, result.reason);
  }
  return report;
}

function finalizeReport(report, inventory) {
  const classifications = {
    ...createEmptyClassificationCounts(),
    ...(report.classifications || {})
  };
  if (inventory.runner_limit_cap_unproven_inventory) {
    classifications.runner_limit_cap_unproven_inventory = Math.max(
      Number(classifications.runner_limit_cap_unproven_inventory || 0),
      Number(inventory.targets_remaining_unscanned || 0)
    );
  }
  const duplicateCount = Number(classifications.already_public_same_source_job_id || 0)
    + Number(classifications.already_public_same_canonical_url || 0)
    + Number(classifications.already_indexable_duplicate || 0);
  const perSource = {
    source: report.source,
    configured_targets: inventory.configured_targets,
    targets_scanned: inventory.targets_scanned,
    targets_remaining_unscanned: inventory.targets_remaining_unscanned,
    rows_fetched: report.rows_fetched,
    rows_parsed: report.rows_parsed,
    clean_candidates: report.clean_candidates,
    net_new_clean_public_candidates: report.net_new_clean_public_candidates,
    already_public_duplicates: duplicateCount,
    expected_public_row_gain: report.expected_public_row_gain,
    quality_risk_of_net_new_rows: report.quality_risk_of_net_new_rows
  };
  return {
    ...report,
    classifications,
    inventory,
    per_source_summary: perSource,
    duplicate_count: duplicateCount,
    update_count: report.existing_public_update_candidates,
    quarantine_count: report.quarantine_candidates,
    rejected_count: report.rejected_candidates,
    net_new_clean_count: report.net_new_clean_public_candidates
  };
}

async function runNetNewEstimate(options = {}, env = process.env) {
  const source = normalizeAtsKey(options.source);
  if (!source) throw new Error("--source=<ats> is required");
  const poolEnv = {
    ...env,
    POSTGRES_STATEMENT_TIMEOUT_MS: String(options.statementTimeoutMs || DEFAULT_STATEMENT_TIMEOUT_MS),
    OPENJOBSLOTS_POSTGRES_STATEMENT_TIMEOUT_MS: String(options.statementTimeoutMs || DEFAULT_STATEMENT_TIMEOUT_MS)
  };
  const pool = options.pool || createPostgresPool({
    enabled: true,
    connectionString: env.DATABASE_URL || env.POSTGRES_URL || "",
    env: poolEnv
  });
  let lock = null;
  const report = createBaseReport({ ...options, source });
  try {
    if (!options.pool) {
      lock = await acquireHeavyJobLock(pool, `ats-estimate-net-new-${source}`);
    }
    const [configuredTargets, targets] = await Promise.all([
      countConfiguredTargets(pool, source, options),
      discoverSourceTargets(pool, { ...options, source })
    ]);
    const inventory = summarizeInventory({
      configuredTargets,
      targetsScanned: targets.length,
      requestedLimit: options.requestedLimit || options.limit,
      effectiveLimit: options.limit,
      offset: options.offset
    });
    const acceptedCandidates = await collectCandidates(pool, targets, { ...options, source }, report);
    await classifyAcceptedCandidates(pool, source, acceptedCandidates, report);
    if (lock) await lock.release("succeeded");
    lock = null;
    return finalizeReport(report, inventory);
  } catch (error) {
    report.ok = false;
    report.error_message = clean(error?.message || error, 1000);
    if (lock) await lock.release("failed");
    lock = null;
    throw error;
  } finally {
    if (!options.pool && pool && typeof pool.end === "function") await pool.end();
  }
}

function parseEstimatorArgs(argv = process.argv.slice(2), env = process.env) {
  const requestedFromEnv = asInt(env.OPENJOBSLOTS_ATS_ESTIMATE_LIMIT, DEFAULT_SOURCE_RUN_LIMIT, 1, 10_000_000);
  const options = {
    source: clean(env.OPENJOBSLOTS_ATS_ESTIMATE_SOURCE).toLowerCase(),
    requestedLimit: requestedFromEnv,
    limit: asInt(requestedFromEnv, DEFAULT_SOURCE_RUN_LIMIT, 1, MAX_RUN_LIMIT),
    offset: asInt(env.OPENJOBSLOTS_ATS_ESTIMATE_OFFSET, 0, 0, MAX_RUN_OFFSET),
    concurrency: asInt(env.OPENJOBSLOTS_ATS_ESTIMATE_CONCURRENCY, 1, 1, MAX_CONCURRENCY),
    hostConcurrency: asInt(env.OPENJOBSLOTS_ATS_ESTIMATE_HOST_CONCURRENCY, 1, 1, MAX_CONCURRENCY),
    statementTimeoutMs: asInt(
      env.OPENJOBSLOTS_HEAVY_SOURCE_STATEMENT_TIMEOUT_MS,
      DEFAULT_STATEMENT_TIMEOUT_MS,
      1000,
      120_000
    ),
    includeDisabled: asBool(env.OPENJOBSLOTS_ATS_ESTIMATE_INCLUDE_DISABLED),
    json: asBool(env.OPENJOBSLOTS_ATS_ESTIMATE_JSON),
    output: clean(env.OPENJOBSLOTS_ATS_ESTIMATE_OUTPUT, 2000)
  };
  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg === "--include-disabled") options.includeDisabled = true;
    else if (arg.startsWith("--source=")) options.source = clean(arg.slice("--source=".length)).toLowerCase();
    else if (arg.startsWith("--limit=")) {
      options.requestedLimit = asInt(arg.slice("--limit=".length), options.requestedLimit, 1, 10_000_000);
      options.limit = asInt(options.requestedLimit, options.limit, 1, MAX_RUN_LIMIT);
    } else if (arg.startsWith("--company-limit=")) {
      options.requestedLimit = asInt(arg.slice("--company-limit=".length), options.requestedLimit, 1, 10_000_000);
      options.limit = asInt(options.requestedLimit, options.limit, 1, MAX_RUN_LIMIT);
    } else if (arg.startsWith("--offset=")) {
      options.offset = asInt(arg.slice("--offset=".length), options.offset, 0, MAX_RUN_OFFSET);
    } else if (arg.startsWith("--concurrency=")) {
      options.concurrency = asInt(arg.slice("--concurrency=".length), options.concurrency, 1, MAX_CONCURRENCY);
    } else if (arg.startsWith("--host-concurrency=")) {
      options.hostConcurrency = asInt(arg.slice("--host-concurrency=".length), options.hostConcurrency, 1, MAX_CONCURRENCY);
    } else if (arg.startsWith("--statement-timeout-ms=")) {
      options.statementTimeoutMs = asInt(arg.slice("--statement-timeout-ms=".length), options.statementTimeoutMs, 1000, 120_000);
    } else if (arg.startsWith("--output=")) {
      options.output = clean(arg.slice("--output=".length), 2000);
    }
  }
  return options;
}

function writeEstimatorOutput(report, outputPath) {
  if (!outputPath) return;
  const resolved = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`);
}

module.exports = {
  ESTIMATE_CLASSIFICATIONS,
  buildExistingLookup,
  candidateQualityRisk,
  classifyCandidateAgainstExisting,
  classifyNonAccepted,
  createEmptyClassificationCounts,
  finalizeReport,
  markCandidateSeen,
  parseEstimatorArgs,
  runNetNewEstimate,
  summarizeInventory,
  writeEstimatorOutput
};
