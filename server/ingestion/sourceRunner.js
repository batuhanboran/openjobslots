const { URL } = require("node:url");
const { createPostgresPool, ensurePostgresSchema } = require("../backends/postgres");
const { acquireHeavyJobLock } = require("../backends/heavyJobLock");
const { upsertPostgresPostings, normalizeAtsKey } = require("../backends/postgresStore");
const { getAdapterForCompany } = require("./adapters");
const { hashPayload } = require("./cache");
const { buildStoredQualityFields, parseQualityFlags } = require("./dataQuality");
const { evaluatePublicPosting, validationFromGate } = require("./publicPostingGate");
const {
  FAILURE_REASONS,
  decideDetailEscalation,
  summarizeEvidence
} = require("./parserEvidence");
const { getSourceSyncPolicy, SOURCE_QUALITY_STATES } = require("./sourceQualityPolicy");
const { recordSourceRunPostingChanges, snapshotRows } = require("./sourceRollback");

const DEFAULT_SOURCE_RUN_LIMIT = 25;
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const DEFAULT_HOST_CONCURRENCY = 1;
const DEFAULT_BATCH_SIZE = 100;
const MAX_RUN_LIMIT = 1000;
const MAX_RUN_OFFSET = 1_000_000;
const MAX_CONCURRENCY = 4;

function nowEpochSeconds() {
  return Math.floor(Date.now() / 1000);
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
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function postingSourceFailureReasons(posting = {}) {
  const values = Array.isArray(posting?.source_failure_reasons)
    ? posting.source_failure_reasons
    : [
        posting?.source_failure_reason,
        posting?.parser_failure_reason,
        posting?.icims_failure_reason
      ];
  return Array.from(new Set(values.map((value) => clean(value, 120)).filter(Boolean)));
}

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    mode: String(env.OPENJOBSLOTS_ATS_SOURCE_MODE || "dry-run").trim().toLowerCase(),
    source: String(env.OPENJOBSLOTS_ATS_SOURCE || "").trim().toLowerCase(),
    limit: asInt(env.OPENJOBSLOTS_ATS_SOURCE_LIMIT, DEFAULT_SOURCE_RUN_LIMIT, 1, MAX_RUN_LIMIT),
    batchSize: asInt(env.OPENJOBSLOTS_ATS_SOURCE_BATCH_SIZE, DEFAULT_BATCH_SIZE, 1, 1000),
    offset: asInt(env.OPENJOBSLOTS_ATS_SOURCE_OFFSET, 0, 0, MAX_RUN_OFFSET),
    concurrency: asInt(env.OPENJOBSLOTS_ATS_SOURCE_CONCURRENCY, 1, 1, MAX_CONCURRENCY),
    hostConcurrency: asInt(env.OPENJOBSLOTS_ATS_SOURCE_HOST_CONCURRENCY, DEFAULT_HOST_CONCURRENCY, 1, MAX_CONCURRENCY),
    statementTimeoutMs: asInt(
      env.OPENJOBSLOTS_HEAVY_SOURCE_STATEMENT_TIMEOUT_MS,
      DEFAULT_STATEMENT_TIMEOUT_MS,
      1000,
      120_000
    ),
    apply: asBool(env.OPENJOBSLOTS_ATS_SOURCE_APPLY),
    confirmProduction: asBool(env.OPENJOBSLOTS_ATS_SOURCE_CONFIRM_PRODUCTION),
    maxUpdates: asInt(env.OPENJOBSLOTS_ATS_SOURCE_MAX_UPDATES, 0, 0, 100_000),
    json: asBool(env.OPENJOBSLOTS_ATS_SOURCE_JSON),
    output: String(env.OPENJOBSLOTS_ATS_SOURCE_OUTPUT || "").trim(),
    includeDisabled: asBool(env.OPENJOBSLOTS_ATS_SOURCE_INCLUDE_DISABLED),
    plannedBatch: String(env.OPENJOBSLOTS_ATS_SOURCE_PLANNED_BATCH || "").trim(),
    predictedGuardResult: String(env.OPENJOBSLOTS_ATS_SOURCE_PREDICTED_GUARD_RESULT || "").trim()
  };

  for (const arg of argv) {
    if (arg === "--apply") options.apply = true;
    else if (arg === "--confirm-production") options.confirmProduction = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--include-disabled") options.includeDisabled = true;
    else if (arg.startsWith("--mode=")) options.mode = String(arg.slice("--mode=".length)).trim().toLowerCase();
    else if (arg.startsWith("--source=")) options.source = String(arg.slice("--source=".length)).trim().toLowerCase();
    else if (arg.startsWith("--limit=")) options.limit = asInt(arg.slice("--limit=".length), options.limit, 1, MAX_RUN_LIMIT);
    else if (arg.startsWith("--company-limit=")) options.limit = asInt(arg.slice("--company-limit=".length), options.limit, 1, MAX_RUN_LIMIT);
    else if (arg.startsWith("--offset=")) options.offset = asInt(arg.slice("--offset=".length), options.offset, 0, MAX_RUN_OFFSET);
    else if (arg.startsWith("--batch-size=")) options.batchSize = asInt(arg.slice("--batch-size=".length), options.batchSize, 1, 1000);
    else if (arg.startsWith("--concurrency=")) options.concurrency = asInt(arg.slice("--concurrency=".length), options.concurrency, 1, MAX_CONCURRENCY);
    else if (arg.startsWith("--host-concurrency=")) options.hostConcurrency = asInt(arg.slice("--host-concurrency=".length), options.hostConcurrency, 1, MAX_CONCURRENCY);
    else if (arg.startsWith("--statement-timeout-ms=")) options.statementTimeoutMs = asInt(arg.slice("--statement-timeout-ms=".length), options.statementTimeoutMs, 1000, 120_000);
    else if (arg.startsWith("--max-updates=")) options.maxUpdates = asInt(arg.slice("--max-updates=".length), options.maxUpdates, 0, 100_000);
    else if (arg.startsWith("--output=")) options.output = String(arg.slice("--output=".length)).trim();
    else if (arg.startsWith("--planned-batch=")) options.plannedBatch = String(arg.slice("--planned-batch=".length)).trim();
    else if (arg.startsWith("--predicted-guard-result=")) options.predictedGuardResult = String(arg.slice("--predicted-guard-result=".length)).trim();
  }

  if (options.mode === "apply") options.apply = true;
  if (options.mode === "dryrun") options.mode = "dry-run";
  return options;
}

function getSafetyGate(options = {}) {
  const applyRequested = Boolean(options.apply);
  return {
    apply_requested: applyRequested,
    authorized: applyRequested && Boolean(options.confirmProduction) && Number(options.maxUpdates || 0) > 0,
    missing: [
      applyRequested && !options.confirmProduction ? "--confirm-production" : "",
      applyRequested && Number(options.maxUpdates || 0) <= 0 ? "--max-updates=N" : ""
    ].filter(Boolean)
  };
}

function sourceHost(value) {
  try {
    return new URL(String(value || "")).host.toLowerCase();
  } catch {
    return "";
  }
}

function incrementCounter(map, key, amount = 1) {
  const normalized = String(key || "unknown");
  map[normalized] = Number(map[normalized] || 0) + amount;
}

async function discoverSourceTargets(pool, options = {}) {
  const source = normalizeAtsKey(options.source);
  if (!source) throw new Error("--source=<ats> is required");
  const enabledFilter = options.includeDisabled ? "" : "AND s.enabled = true AND COALESCE(NULLIF(s.protection_status, ''), 'normal') NOT IN ('disabled', 'auto_disabled')";
  const result = await pool.query(
    `
      SELECT
        c.id,
        c.company_name,
        c.url_string,
        c.ats_key,
        s.enabled,
        s.protection_status,
        s.disabled_reason,
        s.rate_limit_ms
      FROM companies c
      INNER JOIN ats_sources s ON s.ats_key = c.ats_key
      WHERE c.ats_key = $1
        ${enabledFilter}
      ORDER BY c.updated_at DESC, c.id ASC
      LIMIT $2 OFFSET $3;
    `,
    [
      source,
      Math.max(1, Number(options.limit || DEFAULT_SOURCE_RUN_LIMIT)),
      Math.max(0, Number(options.offset || 0))
    ]
  );
  return result.rows.map((row) => {
    const company = {
      id: Number(row.id || 0),
      company_name: String(row.company_name || ""),
      url_string: String(row.url_string || ""),
      ATS_name: String(row.ats_key || "")
    };
    const sourcePolicy = getSourceSyncPolicy(source, {
      protectionStatus: row.protection_status,
      disabledReason: row.disabled_reason
    });
    return {
      company,
      atsKey: source,
      companyUrl: company.url_string,
      host: sourceHost(company.url_string),
      adapter: getAdapterForCompany(company),
      source: {
        enabled: Boolean(row.enabled),
        protection_status: String(row.protection_status || "normal"),
        disabled_reason: String(row.disabled_reason || ""),
        rate_limit_ms: Number(row.rate_limit_ms || 0),
        quality_state: sourcePolicy.source_quality_state,
        policy: sourcePolicy
      },
      sourcePolicy
    };
  }).filter((target) => target.adapter);
}

async function createSourceRun(pool, options = {}, targets = []) {
  const source = normalizeAtsKey(options.source);
  const result = await pool.query(
    `
      INSERT INTO ats_source_runs (
        run_key, ats_key, mode, status, requested_limit, max_updates, source_host_count
      ) VALUES ($1,$2,$3,'running',$4,$5,$6)
      RETURNING id;
    `,
    [
      `ats-source-${source}-${Date.now()}`,
      source,
      String(options.mode || "dry-run"),
      Number(options.limit || 0),
      Number(options.maxUpdates || 0),
      new Set(targets.map((target) => target.host).filter(Boolean)).size
    ]
  );
  return Number(result.rows[0]?.id || 0);
}

async function recordSourceRunError(pool, runId, target, error, metadata = {}) {
  if (!runId) return;
  await pool.query(
    `
      INSERT INTO ats_source_run_errors (
        source_run_id, ats_key, source_host, source_url, error_type, error_message, http_status, parser_reason
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8);
    `,
    [
      runId,
      target?.atsKey || "",
      target?.host || sourceHost(target?.companyUrl),
      target?.companyUrl || "",
      clean(metadata.errorType || error?.ingestionErrorType || "unknown", 80),
      clean(error?.message || error, 1200),
      metadata.httpStatus || null,
      clean(metadata.parserReason || "", 300)
    ]
  );
}

async function finishSourceRun(pool, runId, status, summary, stopReason = "") {
  if (!runId) return;
  await pool.query(
    `
      UPDATE ats_source_runs
      SET status = $2,
          fetch_count = $3,
          parse_count = $4,
          accepted_count = $5,
          quarantined_count = $6,
          rejected_count = $7,
          public_write_count = $8,
          quarantine_write_count = $9,
          http_status_counts = $10::jsonb,
          parser_failure_reasons = $11::jsonb,
          average_latency_ms = $12,
          stop_reason = $13,
          error_message = $14,
          finished_at = now(),
          updated_at = now()
      WHERE id = $1;
    `,
    [
      runId,
      status,
      Number(summary.fetch_count || 0),
      Number(summary.parse_count || 0),
      Number(summary.accepted_count || 0),
      Number(summary.quarantined_count || 0),
      Number(summary.rejected_count || 0),
      Number(summary.public_write_count || 0),
      Number(summary.quarantine_write_count || 0),
      JSON.stringify(summary.http_status_counts || {}),
      JSON.stringify(summary.parser_failure_reasons || {}),
      Number(summary.average_latency_ms || 0),
      clean(stopReason || summary.stop_reason || ""),
      clean(summary.error_message || "")
    ]
  );

  const metrics = {
    fetch_count: summary.fetch_count || 0,
    parse_count: summary.parse_count || 0,
    accepted_count: summary.accepted_count || 0,
    quarantined_count: summary.quarantined_count || 0,
    rejected_count: summary.rejected_count || 0,
    average_latency_ms: summary.average_latency_ms || 0
  };
  for (const [metric, value] of Object.entries(metrics)) {
    await pool.query(
      `
        INSERT INTO ats_source_run_metrics (source_run_id, ats_key, metric_name, metric_value, labels)
        VALUES ($1,$2,$3,$4,$5::jsonb);
      `,
      [runId, normalizeAtsKey(summary.source), metric, Number(value || 0), JSON.stringify({ mode: summary.mode || "" })]
    );
  }
}

async function writeSourcePostingCache(pool, posting, validation, options = {}) {
  const nowEpoch = Number(options.nowEpoch || nowEpochSeconds());
  const canonicalUrl = String(posting?.canonical_url || posting?.job_posting_url || "").trim();
  if (!canonicalUrl) return { cached: false };
  const parserVersion = String(options.parserVersion || posting?.parser_version || "unknown");
  const validationStatus = String(validation?.status || (validation?.ok ? "valid" : "invalid"));
  const validationError = String(validation?.error || "");
  const rawPayloadHash = hashPayload(posting || {});
  const quality = buildStoredQualityFields(
    {
      ...posting,
      validation_status: validationStatus,
      validation_error: validationError,
      parser_version: parserVersion,
      raw_payload_hash: rawPayloadHash,
      last_seen_epoch: nowEpoch
    },
    { nowEpoch }
  );
  await pool.query(
    `
      INSERT INTO posting_cache (
        canonical_url, ats_key, company_name, source_job_id, position_name, location_text,
        city, country, region, remote_type, industry, department, employment_type,
        description_plain, description_html, posting_date, posted_at_epoch,
        raw_payload_hash, source_company_url, first_seen_epoch, last_seen_epoch,
        parser_version, confidence, quality_score, quality_flags, rejection_reason,
        validation_status, validation_error, raw_metadata, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25::jsonb,$26,$27,$28,$29::jsonb,now())
      ON CONFLICT(canonical_url) DO UPDATE SET
        ats_key = EXCLUDED.ats_key,
        company_name = EXCLUDED.company_name,
        source_job_id = EXCLUDED.source_job_id,
        position_name = EXCLUDED.position_name,
        location_text = EXCLUDED.location_text,
        city = EXCLUDED.city,
        country = EXCLUDED.country,
        region = EXCLUDED.region,
        remote_type = EXCLUDED.remote_type,
        industry = EXCLUDED.industry,
        department = EXCLUDED.department,
        employment_type = EXCLUDED.employment_type,
        description_plain = EXCLUDED.description_plain,
        description_html = EXCLUDED.description_html,
        posting_date = EXCLUDED.posting_date,
        posted_at_epoch = EXCLUDED.posted_at_epoch,
        raw_payload_hash = EXCLUDED.raw_payload_hash,
        source_company_url = EXCLUDED.source_company_url,
        last_seen_epoch = EXCLUDED.last_seen_epoch,
        parser_version = EXCLUDED.parser_version,
        confidence = EXCLUDED.confidence,
        quality_score = EXCLUDED.quality_score,
        quality_flags = EXCLUDED.quality_flags,
        rejection_reason = EXCLUDED.rejection_reason,
        validation_status = EXCLUDED.validation_status,
        validation_error = EXCLUDED.validation_error,
        raw_metadata = EXCLUDED.raw_metadata,
        updated_at = now();
    `,
    [
      canonicalUrl,
      String(posting?.ats_key || "").trim(),
      String(posting?.company_name || "").trim(),
      String(posting?.source_job_id || "").trim(),
      String(posting?.position_name || "").trim(),
      posting?.location_text || posting?.location || null,
      String(posting?.city || "").trim(),
      String(posting?.country || "").trim(),
      String(posting?.region || "").trim(),
      String(posting?.remote_type || "unknown").trim(),
      String(posting?.industry || "").trim(),
      String(posting?.department || "").trim(),
      String(posting?.employment_type || "").trim(),
      String(posting?.description_plain || "").trim(),
      String(posting?.description_html || "").trim(),
      posting?.posting_date || null,
      posting?.posted_at_epoch || posting?.posting_date_epoch || null,
      rawPayloadHash,
      String(options.sourceCompanyUrl || "").trim(),
      nowEpoch,
      nowEpoch,
      parserVersion,
      Number(posting?.confidence || posting?.parser_confidence || 0.5),
      quality.quality_score,
      quality.quality_flags,
      quality.rejection_reason,
      validationStatus,
      validationError,
      JSON.stringify({
        source_company_url: String(options.sourceCompanyUrl || "").trim(),
        parser_version: parserVersion,
        visibility_status: validationStatus,
        reason_codes: Array.isArray(validation?.reason_codes) ? validation.reason_codes : [],
        retry_detail_refetch_eligible: Boolean(validation?.retry_detail_refetch_eligible),
        evidence: validation?.evidence || options.evidence || null
      })
    ]
  );
  return { cached: true };
}

function buildInitialSummary(options) {
  return {
    ok: true,
    source: normalizeAtsKey(options.source),
    mode: options.mode || "dry-run",
    apply_mode: false,
    source_run_id: 0,
    scanned_targets: 0,
    fetch_count: 0,
    parse_count: 0,
    accepted_count: 0,
    quarantined_count: 0,
    rejected_count: 0,
    public_write_count: 0,
    quarantine_write_count: 0,
    http_status_counts: {},
    parser_failure_reasons: {},
    average_latency_ms: 0,
    stop_reason: "",
    errors: [],
    samples: [],
    candidate_reports: [],
    planned_tenant_batch_file_path: String(options.plannedBatch || ""),
    predicted_guard_result: String(options.predictedGuardResult || ""),
    rollback_command: ""
  };
}

function extractHttpStatus(error) {
  const explicit = Number(error?.status || error?.statusCode || error?.httpStatus || error?.response?.status || 0);
  if (Number.isFinite(explicit) && explicit >= 100 && explicit <= 599) return explicit;
  const match = String(error?.message || error || "").match(/\b([1-5][0-9]{2})\b/);
  const parsed = match ? Number(match[1]) : 0;
  return Number.isFinite(parsed) && parsed >= 100 && parsed <= 599 ? parsed : null;
}

function publicGateDecision(gate = {}) {
  return {
    status: gate.status || "unknown",
    public: Boolean(gate.public),
    ok: Boolean(gate.ok),
    reason: clean(gate.reason || "", 300),
    reason_codes: Array.isArray(gate.reason_codes) ? gate.reason_codes : [],
    retry_detail_refetch_eligible: Boolean(gate.retry_detail_refetch_eligible),
    confidence: Number(gate.confidence || 0)
  };
}

function nonAcceptedNetNewClassification(status, validation = {}) {
  const reasonCodes = Array.isArray(validation?.reason_codes) ? validation.reason_codes : [];
  const reason = clean(validation?.error || validation?.reason || reasonCodes.join(", "));
  if (reasonCodes.includes("no_geo_no_remote") || reason === "no_geo_no_remote") return "no_geo_no_remote";
  if (reasonCodes.includes("ambiguous_location") || reason === "ambiguous_location") return "ambiguous_location";
  if (status === "rejected") return "rejected_candidate";
  return "quarantine_candidate";
}

function buildCandidateReport(target, normalized, status, gate, validation, detailEscalation) {
  const reasonCodes = Array.from(new Set([
    ...(Array.isArray(validation?.reason_codes) ? validation.reason_codes : []),
    ...(Array.isArray(detailEscalation?.failure_reasons) ? detailEscalation.failure_reasons : [])
  ].map((reason) => clean(reason, 120)).filter(Boolean)));
  return {
    source_url: target.companyUrl,
    source_host: target.host,
    canonical_url: normalized.canonical_url || normalized.job_posting_url || "",
    source_job_id: normalized.source_job_id || "",
    title: normalized.position_name || normalized.title || "",
    status,
    reason: validation?.error || gate.reason || "",
    reason_codes: reasonCodes,
    public_gate_decision: publicGateDecision(gate),
    detail_escalation_decision: detailEscalation,
    evidence_summary: summarizeEvidence(normalized.evidence || gate.evidence || {}),
    net_new_classification: status === "accepted"
      ? "not_evaluated"
      : nonAcceptedNetNewClassification(status, validation)
  };
}

function appendFailureReason(report, reason) {
  const normalized = clean(reason, 120);
  if (!normalized) return;
  report.failure_reasons = Array.from(new Set([
    ...(Array.isArray(report.failure_reasons) ? report.failure_reasons : []),
    normalized
  ]));
}

async function annotateNetNewCandidateReports(pool, target, reports = []) {
  const acceptedReports = reports.filter((report) => report.status === "accepted");
  if (acceptedReports.length === 0) return;
  const sourceJobIds = Array.from(new Set(acceptedReports.map((report) => clean(report.source_job_id, 500)).filter(Boolean)));
  const urls = Array.from(new Set(acceptedReports.flatMap((report) => [
    clean(report.canonical_url, 2000)
  ]).filter(Boolean)));
  if (sourceJobIds.length === 0 && urls.length === 0) {
    for (const report of acceptedReports) report.net_new_classification = "net_new_clean_public_candidate";
    return;
  }
  const result = await pool.query(
    `
      SELECT canonical_url, apply_url, ats_key, source_job_id, hidden
      FROM postings
      WHERE (ats_key = $1 AND $2::text[] <> '{}'::text[] AND source_job_id = ANY($2::text[]))
         OR ($3::text[] <> '{}'::text[] AND (canonical_url = ANY($3::text[]) OR apply_url = ANY($3::text[])));
    `,
    [target.atsKey, sourceJobIds, urls]
  );
  const bySameSourceJobId = new Map();
  const byUrl = new Map();
  for (const row of result.rows || []) {
    const sourceJobId = clean(row.source_job_id, 500);
    if (clean(row.ats_key).toLowerCase() === clean(target.atsKey).toLowerCase() && sourceJobId) {
      if (!bySameSourceJobId.has(sourceJobId)) bySameSourceJobId.set(sourceJobId, []);
      bySameSourceJobId.get(sourceJobId).push(row);
    }
    for (const url of [row.canonical_url, row.apply_url].map((value) => clean(value, 2000)).filter(Boolean)) {
      if (!byUrl.has(url)) byUrl.set(url, []);
      byUrl.get(url).push(row);
    }
  }
  const seenSourceJobIds = new Set();
  const seenUrls = new Set();
  for (const report of acceptedReports) {
    const sourceJobId = clean(report.source_job_id, 500);
    const url = clean(report.canonical_url, 2000);
    if ((sourceJobId && seenSourceJobIds.has(sourceJobId)) || (url && seenUrls.has(url))) {
      report.net_new_classification = "already_indexable_duplicate";
      appendFailureReason(report, FAILURE_REASONS.CANDIDATE_CLEAN_BUT_EXISTING);
      continue;
    }
    if (sourceJobId) seenSourceJobIds.add(sourceJobId);
    if (url) seenUrls.add(url);
    const sourceMatches = sourceJobId ? bySameSourceJobId.get(sourceJobId) || [] : [];
    const urlMatches = url ? byUrl.get(url) || [] : [];
    const hiddenMatch = [...sourceMatches, ...urlMatches].some((row) => row.hidden === true || row.hidden === "true");
    if (hiddenMatch) {
      report.net_new_classification = "stale_or_hidden_reactivation_candidate";
      appendFailureReason(report, FAILURE_REASONS.CANDIDATE_CLEAN_BUT_EXISTING);
    } else if (sourceMatches.length > 0) {
      report.net_new_classification = "already_public_same_source_job_id";
      appendFailureReason(report, FAILURE_REASONS.DUPLICATE_EXISTING_SOURCE_JOB_ID);
      appendFailureReason(report, FAILURE_REASONS.CANDIDATE_CLEAN_BUT_EXISTING);
    } else if (urlMatches.length > 0) {
      report.net_new_classification = "already_public_same_canonical_url";
      appendFailureReason(report, FAILURE_REASONS.DUPLICATE_EXISTING_PUBLIC);
      appendFailureReason(report, FAILURE_REASONS.CANDIDATE_CLEAN_BUT_EXISTING);
    } else {
      report.net_new_classification = "net_new_clean_public_candidate";
    }
  }
}

function evaluateSourceCandidate(target, item, options = {}) {
  const nowEpoch = Number(options.nowEpoch || nowEpochSeconds());
  let normalized = {
    ...target.adapter.normalize(item, target.company, { nowEpoch }),
    ats_key: target.atsKey
  };
  const adapterValidation = target.adapter.validate(normalized);
  const gate = evaluatePublicPosting(
    {
      ...normalized,
      parser_version: target.adapter.parserVersion,
      parser_confidence: Number(normalized?.confidence || normalized?.parser_confidence || 0.5)
    },
    { parserVersion: target.adapter.parserVersion }
  );
  const quarantineOnly = target.sourcePolicy?.source_quality_state === SOURCE_QUALITY_STATES.QUARANTINE_ONLY;
  let validation = adapterValidation?.ok ? validationFromGate(gate) : adapterValidation;
  let status = adapterValidation?.ok ? gate.status : "rejected";
  if (adapterValidation?.ok && gate.status === "accepted" && quarantineOnly) {
    status = "quarantined";
    validation = {
      ok: false,
      status: "quarantined",
      error: "source_disabled_by_threshold",
      reason_codes: ["source_disabled_by_threshold"],
      evidence: gate.evidence,
      retry_detail_refetch_eligible: false
    };
  }
  const sourceFailureReasons = postingSourceFailureReasons(normalized);
  if (normalized?.source_requires_normalized_geo_or_remote === true) {
    const hasNormalizedGeo = Boolean(clean(normalized.country) || clean(normalized.region) || clean(normalized.city));
    const hasExplicitRemote = ["remote", "hybrid", "onsite"].includes(clean(normalized.remote_type).toLowerCase());
    if (!hasNormalizedGeo && !hasExplicitRemote) sourceFailureReasons.push("no_normalized_geo_or_explicit_remote");
  }
  if (adapterValidation?.ok && status === "accepted" && sourceFailureReasons.length > 0) {
    status = "quarantined";
    validation = {
      ok: false,
      status: "quarantined",
      error: sourceFailureReasons[0],
      reason_codes: Array.from(new Set(sourceFailureReasons)),
      evidence: gate.evidence,
      retry_detail_refetch_eligible: false
    };
  }
  if (adapterValidation?.ok && status === "quarantined" && sourceFailureReasons.length > 0) {
    validation = {
      ...validation,
      error: sourceFailureReasons[0],
      reason_codes: Array.from(new Set([
        ...sourceFailureReasons,
        ...(Array.isArray(validation?.reason_codes) ? validation.reason_codes : [])
      ]))
    };
  }
  const detailEscalation = normalized.detail_escalation_decision || decideDetailEscalation(normalized, {
    sourceFamily: normalized.source_family || target.adapter.metadata?.sourceFamily || "",
    detailSupported: typeof target.adapter.fetchDetail === "function"
  });
  return {
    normalized,
    adapterValidation,
    gate,
    validation,
    status,
    sourceFailureReasons,
    detailEscalation
  };
}

async function processTarget(pool, target, options, summary, runId) {
  const started = Date.now();
  const nowEpoch = nowEpochSeconds();
  let raw;
  try {
    raw = await target.adapter.fetch(target.company);
    summary.fetch_count += 1;
  } catch (error) {
    const httpStatus = extractHttpStatus(error);
    if (httpStatus) incrementCounter(summary.http_status_counts, httpStatus);
    incrementCounter(summary.parser_failure_reasons, error?.ingestionErrorType || "fetch_failed");
    await recordSourceRunError(pool, runId, target, error, { httpStatus, errorType: error?.ingestionErrorType || "fetch" });
    summary.errors.push({ source_url: target.companyUrl, error: clean(error?.message || error, 240) });
    return;
  } finally {
    summary.average_latency_ms = Math.round(
      ((summary.average_latency_ms * Math.max(0, summary.fetch_count - 1)) + (Date.now() - started)) /
      Math.max(1, summary.fetch_count)
    );
  }

  let parsed;
  try {
    parsed = target.adapter.parse(raw, target.company);
    summary.parse_count += Array.isArray(parsed) ? parsed.length : 0;
  } catch (error) {
    incrementCounter(summary.parser_failure_reasons, "parser_parse");
    await recordSourceRunError(pool, runId, target, error, { errorType: "parser_parse" });
    summary.errors.push({ source_url: target.companyUrl, error: clean(error?.message || error, 240) });
    return;
  }

  const accepted = [];
  const targetCandidateReports = [];
  const safetyGate = getSafetyGate(options);
  for (const item of Array.isArray(parsed) ? parsed : []) {
    let evaluated;
    try {
      evaluated = evaluateSourceCandidate(target, item, { nowEpoch });
    } catch (error) {
      summary.rejected_count += 1;
      incrementCounter(summary.parser_failure_reasons, "parser_normalize");
      await recordSourceRunError(pool, runId, target, error, { errorType: "parser_normalize" });
      continue;
    }
    const { normalized, gate, validation, status, detailEscalation } = evaluated;
    const candidateReport = buildCandidateReport(target, normalized, status, gate, validation, detailEscalation);
    targetCandidateReports.push(candidateReport);
    if (status === "accepted") {
      summary.accepted_count += 1;
      accepted.push(normalized);
    } else if (status === "quarantined") {
      summary.quarantined_count += 1;
      incrementCounter(summary.parser_failure_reasons, validation?.error || "quarantined");
    } else {
      summary.rejected_count += 1;
      incrementCounter(summary.parser_failure_reasons, validation?.error || "rejected");
      await recordSourceRunError(pool, runId, target, new Error(validation?.error || "rejected"), {
        errorType: "parser_validation",
        parserReason: validation?.error || "rejected"
      });
    }

    if (summary.samples.length < 10) {
      summary.samples.push({
        source_url: target.companyUrl,
        canonical_url: normalized.canonical_url || normalized.job_posting_url || "",
        title: normalized.position_name || normalized.title || "",
        status,
        reason: validation?.error || gate.reason || "",
        public_gate_decision: candidateReport.public_gate_decision,
        detail_escalation_decision: candidateReport.detail_escalation_decision,
        evidence_summary: candidateReport.evidence_summary,
        net_new_classification: candidateReport.net_new_classification
      });
    }

    if (!safetyGate.authorized) continue;
    const writesUsed = summary.public_write_count + summary.quarantine_write_count;
    if (writesUsed >= Number(options.maxUpdates || 0)) {
      summary.stop_reason = "max_updates_reached";
      continue;
    }
    if (status === "accepted") {
      continue;
    }
    if (status === "quarantined") {
      await writeSourcePostingCache(pool, normalized, validation, {
        nowEpoch,
        parserVersion: target.adapter.parserVersion,
        sourceCompanyUrl: target.companyUrl,
        evidence: gate.evidence
      });
      summary.quarantine_write_count += 1;
    }
  }

  if (!safetyGate.authorized && targetCandidateReports.length > 0) {
    try {
      await annotateNetNewCandidateReports(pool, target, targetCandidateReports);
      const classificationByUrl = new Map(targetCandidateReports.map((report) => [report.canonical_url, report.net_new_classification]));
      for (const sample of summary.samples) {
        if (classificationByUrl.has(sample.canonical_url)) {
          sample.net_new_classification = classificationByUrl.get(sample.canonical_url);
        }
      }
    } catch (error) {
      for (const report of targetCandidateReports) {
        if (report.status === "accepted") report.net_new_classification = "net_new_estimator_unavailable";
      }
      incrementCounter(summary.parser_failure_reasons, "net_new_estimator_unavailable");
      summary.errors.push({ source_url: target.companyUrl, error: clean(error?.message || error, 240) });
    }
  }
  summary.candidate_reports.push(...targetCandidateReports);
  summary.candidate_report_count = summary.candidate_reports.length;

  if (safetyGate.authorized && accepted.length > 0) {
    const remaining = Math.max(0, Number(options.maxUpdates || 0) - summary.public_write_count - summary.quarantine_write_count);
    const toWrite = accepted.slice(0, remaining);
    if (toWrite.length > 0) {
      const canonicalUrls = toWrite.map((posting) => clean(posting.canonical_url || posting.job_posting_url, 2000)).filter(Boolean);
      const beforePostings = runId ? await snapshotRows(pool, "postings", canonicalUrls) : new Map();
      const beforeCache = runId ? await snapshotRows(pool, "posting_cache", canonicalUrls) : new Map();
      await upsertPostgresPostings(pool, toWrite, {
        nowEpoch,
        parserVersion: target.adapter.parserVersion
      });
      for (const posting of toWrite) {
        await writeSourcePostingCache(pool, posting, { ok: true, status: "valid", error: "" }, {
          nowEpoch,
          parserVersion: target.adapter.parserVersion,
          sourceCompanyUrl: target.companyUrl
        });
      }
      if (runId) {
        const afterPostings = await snapshotRows(pool, "postings", canonicalUrls);
        const afterCache = await snapshotRows(pool, "posting_cache", canonicalUrls);
        const recorded = await recordSourceRunPostingChanges(pool, {
          runId,
          source: target.atsKey,
          target,
          postings: toWrite,
          beforePostings,
          beforeCache,
          afterPostings,
          afterCache
        });
        summary.rollback_command = `npm run ats:source:rollback -- --run-id=${runId} --source=${target.atsKey} --confirm-production --json`;
        summary.source_write_audit_count = Number(summary.source_write_audit_count || 0) + Number(recorded.recorded || 0);
      }
      summary.public_write_count += toWrite.length;
    }
    if (toWrite.length < accepted.length) summary.stop_reason = "max_updates_reached";
  }
}

async function runWithLimitedConcurrency(items, worker, options = {}) {
  const concurrency = Math.max(1, Math.min(MAX_CONCURRENCY, Number(options.concurrency || 1)));
  let index = 0;
  const hostChains = new Map();
  async function runForHost(item) {
    const host = item.host || "";
    if (!host) return worker(item);
    const previous = hostChains.get(host) || Promise.resolve();
    let release = () => {};
    const current = previous.then(() => new Promise((resolve) => {
      release = resolve;
    }));
    hostChains.set(host, current);
    await previous;
    try {
      return await worker(item);
    } finally {
      release();
      if (hostChains.get(host) === current) hostChains.delete(host);
    }
  }
  async function runOne() {
    while (index < items.length) {
      const item = items[index++];
      await runForHost(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, () => runOne()));
}

async function runSourceJob(options = parseArgs(), env = process.env) {
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
  let sourceRunId = 0;
  const summary = buildInitialSummary(options);
  const safetyGate = getSafetyGate(options);
  summary.safety_gate = safetyGate;
  summary.apply_mode = safetyGate.authorized;
  summary.statement_timeout_ms = Number(options.statementTimeoutMs || DEFAULT_STATEMENT_TIMEOUT_MS);

  try {
    if (!options.pool) {
      await ensurePostgresSchema(pool);
      lock = await acquireHeavyJobLock(pool, `ats-source-${summary.source}-${options.mode || "dry-run"}`);
    }
    const targets = await discoverSourceTargets(pool, options);
    summary.scanned_targets = targets.length;
    summary.source_host_count = new Set(targets.map((target) => target.host).filter(Boolean)).size;
    if (options.mode !== "dry-run" || safetyGate.authorized) {
      sourceRunId = await createSourceRun(pool, options, targets);
      summary.source_run_id = sourceRunId;
    }
    await runWithLimitedConcurrency(
      targets,
      (target) => {
        if (summary.stop_reason === "max_updates_reached") return null;
        return processTarget(pool, target, options, summary, sourceRunId);
      },
      options
    );
    const status = summary.errors.length > 0 ? "completed_with_errors" : "completed";
    if (sourceRunId) await finishSourceRun(pool, sourceRunId, status, summary, summary.stop_reason);
    if (lock) await lock.release("succeeded");
    lock = null;
    return summary;
  } catch (error) {
    summary.ok = false;
    summary.error_message = clean(error?.message || error, 1000);
    if (sourceRunId) await finishSourceRun(pool, sourceRunId, "failed", summary, "error");
    if (lock) await lock.release("failed");
    lock = null;
    throw error;
  } finally {
    if (!options.pool && pool && typeof pool.end === "function") await pool.end();
  }
}

const sourceRunnerInterface = Object.freeze({
  discover: discoverSourceTargets,
  fetchList: (target) => target.adapter.fetch(target.company),
  fetchDetail: async () => null,
  parseList: (target, raw) => target.adapter.parse(raw, target.company),
  parseDetail: async () => [],
  normalize: (target, item, nowEpoch = nowEpochSeconds()) => target.adapter.normalize(item, target.company, { nowEpoch }),
  validate: (target, posting) => target.adapter.validate(posting),
  writeAccepted: upsertPostgresPostings,
  writeQuarantine: writeSourcePostingCache
});

module.exports = {
  DEFAULT_HOST_CONCURRENCY,
  MAX_RUN_LIMIT,
  DEFAULT_SOURCE_RUN_LIMIT,
  evaluateSourceCandidate,
  getSafetyGate,
  parseArgs,
  runSourceJob,
  sourceHost,
  sourceRunnerInterface,
  discoverSourceTargets,
  runWithLimitedConcurrency
};
