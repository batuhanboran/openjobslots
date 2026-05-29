const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
const { createPostgresPool } = require("../backends/postgres");
const { acquireHeavyJobLock } = require("../backends/heavyJobLock");
const { normalizeAtsKey } = require("../backends/postgresStore");
const {
  MAX_RUN_LIMIT,
  DEFAULT_SOURCE_RUN_LIMIT,
  discoverSourceTargets,
  evaluateSourceCandidate,
  runWithLimitedConcurrency
} = require("./sourceRunner");
const { safeFetch } = require("./safeFetch");
const {
  buildExistingLookup,
  candidateQualityRisk,
  classifyCandidateAgainstExisting,
  classifyNonAccepted,
  createEmptyClassificationCounts,
  getExistingRowsForCandidates,
  markCandidateSeen,
  countConfiguredTargets,
  summarizeInventory
} = require("./netNewEstimator");
const { getMethodExperimentSources } = require("./sourceMethodProfiles");

const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const DEFAULT_ROW_LIMIT = 10_000;
const MAX_ROW_LIMIT = 100_000;
const MAX_RUN_OFFSET = 1_000_000;
const MAX_CONCURRENCY = 4;
const DEFAULT_DETAIL_SAMPLE_LIMIT = 5;
const MAX_DETAIL_SAMPLE_LIMIT = 25;
const ALLOWED_EXPERIMENT_SOURCES = new Set(getMethodExperimentSources());

function nowIso() {
  return new Date().toISOString();
}

function clean(value, max = 1000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function asInt(value, fallback, min, max) {
  const parsed = Number(value);
  const number = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  return Math.max(min, Math.min(max, number));
}

function asBool(value) {
  return ["1", "true", "yes", "y", "on"].includes(String(value || "").trim().toLowerCase());
}

function incrementCounter(map, key, amount = 1) {
  const normalized = clean(key || "unknown", 180);
  map[normalized] = Number(map[normalized] || 0) + Number(amount || 0);
}

function pct(numerator, denominator) {
  if (!denominator) return 0;
  return Number(((Number(numerator || 0) / Number(denominator || 1)) * 100).toFixed(2));
}

function getCanonicalUrl(posting = {}) {
  return clean(posting.canonical_url || posting.job_posting_url || posting.apply_url || posting.source_url, 2000);
}

function getSourceJobId(posting = {}) {
  return clean(posting.source_job_id || posting.source_derived_id || posting.stable_source_id || posting.job_id || posting.id, 500);
}

function hostFromUrl(value) {
  try {
    return new URL(clean(value)).host.toLowerCase();
  } catch {
    return "";
  }
}

function parseMethodExperimentArgs(argv = process.argv.slice(2), env = process.env) {
  const requestedLimit = asInt(
    env.OPENJOBSLOTS_ATS_METHOD_COMPANY_LIMIT || env.OPENJOBSLOTS_ATS_METHOD_LIMIT,
    DEFAULT_SOURCE_RUN_LIMIT,
    1,
    10_000_000
  );
  const options = {
    source: clean(env.OPENJOBSLOTS_ATS_METHOD_SOURCE).toLowerCase(),
    requestedLimit,
    limit: Math.min(requestedLimit, MAX_RUN_LIMIT),
    offset: asInt(env.OPENJOBSLOTS_ATS_METHOD_OFFSET, 0, 0, MAX_RUN_OFFSET),
    rowLimit: asInt(env.OPENJOBSLOTS_ATS_METHOD_ROW_LIMIT, DEFAULT_ROW_LIMIT, 1, MAX_ROW_LIMIT),
    concurrency: asInt(env.OPENJOBSLOTS_ATS_METHOD_CONCURRENCY, 1, 1, MAX_CONCURRENCY),
    hostConcurrency: asInt(env.OPENJOBSLOTS_ATS_METHOD_HOST_CONCURRENCY, 1, 1, MAX_CONCURRENCY),
    detailSampleLimit: asInt(env.OPENJOBSLOTS_ATS_METHOD_DETAIL_SAMPLE_LIMIT, DEFAULT_DETAIL_SAMPLE_LIMIT, 0, MAX_DETAIL_SAMPLE_LIMIT),
    statementTimeoutMs: asInt(
      env.OPENJOBSLOTS_HEAVY_SOURCE_STATEMENT_TIMEOUT_MS,
      DEFAULT_STATEMENT_TIMEOUT_MS,
      1000,
      120_000
    ),
    includeDisabled: asBool(env.OPENJOBSLOTS_ATS_METHOD_INCLUDE_DISABLED),
    json: asBool(env.OPENJOBSLOTS_ATS_METHOD_JSON),
    output: clean(env.OPENJOBSLOTS_ATS_METHOD_OUTPUT, 4000)
  };

  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg === "--include-disabled") options.includeDisabled = true;
    else if (arg === "--apply" || arg === "--confirm-production" || arg.startsWith("--max-updates=")) {
      throw new Error("ats:method:experiment is read-only and refuses apply/canary/write flags");
    } else if (arg.startsWith("--source=")) options.source = clean(arg.slice("--source=".length)).toLowerCase();
    else if (arg.startsWith("--limit=")) {
      options.requestedLimit = asInt(arg.slice("--limit=".length), options.requestedLimit, 1, 10_000_000);
      options.limit = Math.min(options.requestedLimit, MAX_RUN_LIMIT);
    } else if (arg.startsWith("--company-limit=")) {
      options.requestedLimit = asInt(arg.slice("--company-limit=".length), options.requestedLimit, 1, 10_000_000);
      options.limit = Math.min(options.requestedLimit, MAX_RUN_LIMIT);
    } else if (arg.startsWith("--offset=")) options.offset = asInt(arg.slice("--offset=".length), options.offset, 0, MAX_RUN_OFFSET);
    else if (arg.startsWith("--row-limit=")) options.rowLimit = asInt(arg.slice("--row-limit=".length), options.rowLimit, 1, MAX_ROW_LIMIT);
    else if (arg.startsWith("--concurrency=")) options.concurrency = asInt(arg.slice("--concurrency=".length), options.concurrency, 1, MAX_CONCURRENCY);
    else if (arg.startsWith("--host-concurrency=")) options.hostConcurrency = asInt(arg.slice("--host-concurrency=".length), options.hostConcurrency, 1, MAX_CONCURRENCY);
    else if (arg.startsWith("--detail-sample-limit=")) options.detailSampleLimit = asInt(arg.slice("--detail-sample-limit=".length), options.detailSampleLimit, 0, MAX_DETAIL_SAMPLE_LIMIT);
    else if (arg.startsWith("--statement-timeout-ms=")) options.statementTimeoutMs = asInt(arg.slice("--statement-timeout-ms=".length), options.statementTimeoutMs, 1000, 120_000);
    else if (arg.startsWith("--output=")) options.output = clean(arg.slice("--output=".length), 4000);
  }
  return options;
}

function createBaseReport(options = {}) {
  const source = normalizeAtsKey(options.source);
  return {
    ok: true,
    generated_at: nowIso(),
    mode: "method-experiment",
    read_only: true,
    source,
    allowed_scope: Array.from(ALLOWED_EXPERIMENT_SOURCES),
    requested_company_limit: Number(options.requestedLimit || options.limit || DEFAULT_SOURCE_RUN_LIMIT),
    effective_company_limit: Number(options.limit || DEFAULT_SOURCE_RUN_LIMIT),
    offset: Number(options.offset || 0),
    row_limit: Number(options.rowLimit || DEFAULT_ROW_LIMIT),
    detail_sample_limit_per_tenant: Number(options.detailSampleLimit || 0),
    statement_timeout_ms: Number(options.statementTimeoutMs || DEFAULT_STATEMENT_TIMEOUT_MS),
    configured_targets: 0,
    scanned_targets: 0,
    source_host_count: 0,
    rows_fetched: 0,
    rows_parsed: 0,
    accepted_candidates: 0,
    net_new_clean_candidates: 0,
    duplicates: 0,
    quarantine_candidates: 0,
    rejected_candidates: 0,
    existing_public_update_candidates: 0,
    stale_or_hidden_reactivation_candidates: 0,
    no_geo_no_remote_candidates: 0,
    missing_geo_candidates: 0,
    weak_unknown_remote_candidates: 0,
    classifications: createEmptyClassificationCounts(),
    parser_failure_reasons: {},
    http_status_counts: {},
    detail_http_status_counts: {},
    method_attempt_counts: {},
    tenant_reports: [],
    errors: [],
    samples: [],
    stop_reason: ""
  };
}

function createTenantReport(target) {
  return {
    source: target.atsKey || normalizeAtsKey(target?.company?.ATS_name),
    tenant_host: clean(target.host || hostFromUrl(target.companyUrl), 300),
    company: clean(target.company?.company_name, 300),
    target_url: clean(target.companyUrl, 2000),
    method_attempted: "list_only",
    method_attempts: ["list_only"],
    http_status: null,
    rows_fetched: 0,
    rows_parsed: 0,
    accepted_candidates: 0,
    net_new_clean_candidates: 0,
    duplicates: 0,
    quarantine_candidates: 0,
    rejected_candidates: 0,
    existing_public_update_candidates: 0,
    stale_or_hidden_reactivation_candidates: 0,
    no_geo_no_remote_candidates: 0,
    missing_geo_candidates: 0,
    weak_unknown_remote_candidates: 0,
    detail_fetch_needed: false,
    detail_supported: false,
    detail_methods: {
      attempted: 0,
      successful: 0,
      failed: 0,
      http_status_counts: {},
      embedded_json: 0,
      json_ld_jobposting: 0,
      labeled_html: 0,
      labeled_location: 0,
      labeled_remote_or_work_type: 0,
      labeled_posting_date: 0,
      canonical_url_or_source_id: 0
    },
    parser_failure_reasons: {},
    top_sample_urls: [],
    expected_parser_changes_required: []
  };
}

function recordSample(report, tenantReport, normalized, classification, reason) {
  const sample = {
    tenant_host: tenantReport.tenant_host,
    target_url: tenantReport.target_url,
    canonical_url: getCanonicalUrl(normalized),
    source_job_id: getSourceJobId(normalized),
    title: clean(normalized.position_name || normalized.title, 300),
    classification,
    reason: clean(reason, 300)
  };
  if (report.samples.length < 50) report.samples.push(sample);
  if (tenantReport.top_sample_urls.length < 10 && sample.canonical_url) {
    tenantReport.top_sample_urls.push(sample.canonical_url);
  }
}

function reasonCodesFromEvaluation(evaluated = {}) {
  const gateReasonCodes = Array.isArray(evaluated.gate?.reason_codes) ? evaluated.gate.reason_codes : [];
  const validationCodes = Array.isArray(evaluated.validation?.reason_codes) ? evaluated.validation.reason_codes : [];
  const detailReasons = Array.isArray(evaluated.detailEscalation?.failure_reasons) ? evaluated.detailEscalation.failure_reasons : [];
  const validationError = clean(evaluated.validation?.error || evaluated.gate?.reason);
  return Array.from(new Set([
    ...gateReasonCodes,
    ...validationCodes,
    ...detailReasons,
    validationError
  ].map((reason) => clean(reason, 180)).filter(Boolean)));
}

function updateQualityRiskCounters(report, tenantReport, candidate) {
  const risk = candidateQualityRisk(candidate);
  if (risk.no_geo_no_remote) {
    report.no_geo_no_remote_candidates += 1;
    tenantReport.no_geo_no_remote_candidates += 1;
  }
  if (risk.missing_any_geo) {
    report.missing_geo_candidates += 1;
    tenantReport.missing_geo_candidates += 1;
  }
  if (risk.weak_unknown_remote) {
    report.weak_unknown_remote_candidates += 1;
    tenantReport.weak_unknown_remote_candidates += 1;
  }
}

function addMethodAttempt(report, tenantReport, method) {
  const normalized = clean(method, 80);
  if (!normalized) return;
  if (!tenantReport.method_attempts.includes(normalized)) tenantReport.method_attempts.push(normalized);
  tenantReport.method_attempted = tenantReport.method_attempts.join(",");
  incrementCounter(report.method_attempt_counts, normalized);
}

function extractHttpStatus(error) {
  const explicit = Number(error?.status || error?.statusCode || error?.httpStatus || error?.response?.status || 0);
  if (Number.isFinite(explicit) && explicit >= 100 && explicit <= 599) return explicit;
  const match = String(error?.message || error || "").match(/\b([1-5][0-9]{2})\b/);
  const parsed = match ? Number(match[1]) : 0;
  return Number.isFinite(parsed) && parsed >= 100 && parsed <= 599 ? parsed : null;
}

function decodeEntities(value) {
  return clean(value, 4000)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripTags(value) {
  return decodeEntities(String(value || "").replace(/<[^>]*>/g, " "));
}

function hasEmbeddedJson(html) {
  const text = String(html || "");
  return /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>/i.test(text) ||
    /<script[^>]+type=["']application\/json["'][^>]*>/i.test(text) ||
    /window\.(?:__INITIAL_STATE__|__NUXT__|__APP_DATA__|__APOLLO_STATE__)\s*=/i.test(text);
}

function extractJsonLdJobPostingCount(html) {
  const text = String(html || "");
  const matches = text.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  return matches.filter((match) => /JobPosting/i.test(match)).length;
}

function hasCanonicalOrSourceId(html, url) {
  const text = String(html || "");
  if (/<link[^>]+rel=["']canonical["'][^>]+href=["'][^"']+["']/i.test(text)) return true;
  const pathParts = (() => {
    try {
      return new URL(url).pathname.split("/").filter(Boolean);
    } catch {
      return [];
    }
  })();
  if (pathParts.some((part) => /[a-z0-9]*\d+[a-z0-9-]*/i.test(part) && part.length >= 3)) return true;
  return /\b(?:jobId|job_id|postingId|posting_id|requisitionId|requisition_id)\b/i.test(text);
}

function labelRegex(labels) {
  return new RegExp(
    `(?:<(?:dt|th|strong|b|label|span|div)[^>]*>\\s*(?:${labels})\\s*:?\\s*<\\/[^>]+>\\s*<[^>]+>\\s*([^<]{1,220})|(?:${labels})\\s*:?\\s*<\\/[^>]+>\\s*<[^>]+>\\s*([^<]{1,220})|(?:${labels})\\s*[:\\-]\\s*([^<\\n\\r]{1,220}))`,
    "i"
  );
}

function findLabeledValue(html, labels) {
  const text = String(html || "");
  const match = text.match(labelRegex(labels));
  if (!match) return "";
  return stripTags(match[1] || match[2] || match[3] || "");
}

function inspectDetailHtml(html, url) {
  const locationValue = findLabeledValue(html, "Location|Job Location|Work Location|Office|Worksite|Address");
  const remoteValue = findLabeledValue(html, "Remote|Work Type|Workplace|Workplace Type|Work Location|Job Type|Employment Type");
  const dateValue = findLabeledValue(html, "Date Posted|Posted|Posting Date|Opened|Created|Published");
  const jsonLdJobPosting = extractJsonLdJobPostingCount(html);
  const embeddedJson = hasEmbeddedJson(html);
  return {
    embedded_json: embeddedJson,
    json_ld_jobposting: jsonLdJobPosting > 0,
    json_ld_jobposting_count: jsonLdJobPosting,
    labeled_html: Boolean(locationValue || remoteValue || dateValue),
    labeled_location: Boolean(locationValue),
    labeled_remote_or_work_type: Boolean(remoteValue),
    labeled_posting_date: Boolean(dateValue),
    canonical_url_or_source_id: hasCanonicalOrSourceId(html, url),
    sample_values: {
      location: clean(locationValue, 220),
      remote_or_work_type: clean(remoteValue, 220),
      posting_date: clean(dateValue, 220)
    }
  };
}

async function fetchDetailHtml(url, options = {}) {
  if (typeof options.fetchDetail === "function") {
    const response = await options.fetchDetail(url);
    if (typeof response === "string") return { status: 200, url, text: response };
    if (response && typeof response === "object") {
      if (typeof response.text === "function") {
        return {
          status: Number(response.status || 200),
          url: response.url || url,
          text: await response.text()
        };
      }
      return {
        status: Number(response.status || 200),
        url: response.url || url,
        text: String(response.text || response.html || response.body || "")
      };
    }
    return { status: 200, url, text: String(response || "") };
  }
  const response = await safeFetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/json;q=0.7,*/*;q=0.5",
      "user-agent": "OpenJobSlotsBot/1.0 (+https://openjobslots.com)"
    }
  });
  return {
    status: Number(response.status || 0),
    url: response.url || url,
    text: await response.text()
  };
}

async function inspectDetailCandidates(report, tenantReport, candidates, options = {}) {
  const detailCandidates = candidates
    .filter(({ normalized, detailEscalation }) => {
      const url = getCanonicalUrl(normalized);
      return url && detailEscalation && !detailEscalation.detail_not_needed &&
        (detailEscalation.need_detail_for_geo || detailEscalation.need_detail_for_remote || detailEscalation.need_detail_for_date);
    })
    .slice(0, Number(options.detailSampleLimit || 0));

  if (detailCandidates.length === 0) return;
  addMethodAttempt(report, tenantReport, "detail_page");
  tenantReport.detail_methods.attempted += detailCandidates.length;
  for (const { normalized } of detailCandidates) {
    const url = getCanonicalUrl(normalized);
    try {
      const detail = await fetchDetailHtml(url, options);
      const status = Number(detail.status || 0);
      incrementCounter(report.detail_http_status_counts, status || "unknown");
      incrementCounter(tenantReport.detail_methods.http_status_counts, status || "unknown");
      if (status < 200 || status >= 400) {
        tenantReport.detail_methods.failed += 1;
        incrementCounter(tenantReport.parser_failure_reasons, status === 404 || status === 410 ? "detail_404_or_410" : "detail_fetch_failed");
        incrementCounter(report.parser_failure_reasons, status === 404 || status === 410 ? "detail_404_or_410" : "detail_fetch_failed");
        continue;
      }
      tenantReport.detail_methods.successful += 1;
      const inspected = inspectDetailHtml(detail.text, detail.url || url);
      for (const [key, value] of Object.entries(inspected)) {
        if (key === "sample_values" || key === "json_ld_jobposting_count") continue;
        if (value && Object.prototype.hasOwnProperty.call(tenantReport.detail_methods, key)) {
          tenantReport.detail_methods[key] += 1;
        }
      }
      if (inspected.embedded_json) addMethodAttempt(report, tenantReport, "embedded_json");
      if (inspected.json_ld_jobposting) addMethodAttempt(report, tenantReport, "json_ld");
      if (inspected.labeled_html) addMethodAttempt(report, tenantReport, "labeled_html");
      if (inspected.labeled_location) addMethodAttempt(report, tenantReport, "location_label");
      if (inspected.labeled_remote_or_work_type) addMethodAttempt(report, tenantReport, "remote_work_type_label");
      if (inspected.labeled_posting_date) addMethodAttempt(report, tenantReport, "posting_date_label");
      if (inspected.canonical_url_or_source_id) addMethodAttempt(report, tenantReport, "canonical_url_source_id");
    } catch (error) {
      const status = extractHttpStatus(error);
      tenantReport.detail_methods.failed += 1;
      incrementCounter(report.detail_http_status_counts, status || "error");
      incrementCounter(tenantReport.detail_methods.http_status_counts, status || "error");
      incrementCounter(tenantReport.parser_failure_reasons, error?.ingestionErrorType || "detail_fetch_failed");
      incrementCounter(report.parser_failure_reasons, error?.ingestionErrorType || "detail_fetch_failed");
    }
  }
}

async function processTarget(target, options, report, acceptedCandidates) {
  if (report.rows_parsed >= Number(options.rowLimit || DEFAULT_ROW_LIMIT)) return;
  const tenantReport = createTenantReport(target);
  report.tenant_reports.push(tenantReport);
  const evaluatedCandidates = [];
  let raw;
  try {
    raw = await target.adapter.fetch(target.company);
    report.rows_fetched += 1;
    tenantReport.rows_fetched += 1;
    tenantReport.http_status = 200;
    incrementCounter(report.http_status_counts, 200);
  } catch (error) {
    const httpStatus = extractHttpStatus(error);
    tenantReport.http_status = httpStatus || null;
    if (httpStatus) incrementCounter(report.http_status_counts, httpStatus);
    incrementCounter(report.classifications, "source_fetch_failure");
    incrementCounter(report.parser_failure_reasons, error?.ingestionErrorType || "source_fetch_failure");
    incrementCounter(tenantReport.parser_failure_reasons, error?.ingestionErrorType || "source_fetch_failure");
    report.errors.push({
      source: report.source,
      tenant_host: tenantReport.tenant_host,
      target_url: tenantReport.target_url,
      error: clean(error?.message || error, 400)
    });
    return;
  }

  let rows;
  try {
    const parsed = target.adapter.parse(raw, target.company);
    rows = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    incrementCounter(report.classifications, "parser_failure");
    incrementCounter(report.parser_failure_reasons, "unsupported_html_shape");
    incrementCounter(tenantReport.parser_failure_reasons, "unsupported_html_shape");
    report.errors.push({
      source: report.source,
      tenant_host: tenantReport.tenant_host,
      target_url: tenantReport.target_url,
      error: clean(error?.message || error, 400)
    });
    return;
  }

  if (rows.length === 0) {
    incrementCounter(report.parser_failure_reasons, "unsupported_html_shape");
    incrementCounter(tenantReport.parser_failure_reasons, "unsupported_html_shape");
  }
  const remaining = Math.max(0, Number(options.rowLimit || DEFAULT_ROW_LIMIT) - report.rows_parsed);
  const rowsToEvaluate = rows.slice(0, remaining);
  report.rows_parsed += rowsToEvaluate.length;
  tenantReport.rows_parsed += rowsToEvaluate.length;
  if (rows.length > rowsToEvaluate.length) report.stop_reason = "row_limit_reached";
  const nowEpoch = Math.floor(Date.now() / 1000);
  for (const item of rowsToEvaluate) {
    let evaluated;
    try {
      evaluated = evaluateSourceCandidate(target, item, { nowEpoch });
    } catch (error) {
      report.rejected_candidates += 1;
      tenantReport.rejected_candidates += 1;
      incrementCounter(report.classifications, "parser_failure");
      incrementCounter(report.parser_failure_reasons, "parser_failure");
      incrementCounter(tenantReport.parser_failure_reasons, "parser_failure");
      recordSample(report, tenantReport, {}, "parser_failure", error?.message || error);
      continue;
    }
    const { normalized, status, validation, detailEscalation } = evaluated;
    evaluatedCandidates.push({ normalized, status, validation, detailEscalation });
    updateQualityRiskCounters(report, tenantReport, normalized);
    tenantReport.detail_fetch_needed = tenantReport.detail_fetch_needed || Boolean(
      detailEscalation?.need_detail_for_geo ||
      detailEscalation?.need_detail_for_remote ||
      detailEscalation?.need_detail_for_date
    );
    tenantReport.detail_supported = tenantReport.detail_supported || Boolean(detailEscalation?.detail_supported);
    for (const reason of reasonCodesFromEvaluation(evaluated)) {
      incrementCounter(report.parser_failure_reasons, reason);
      incrementCounter(tenantReport.parser_failure_reasons, reason);
    }

    if (status === "accepted") {
      report.accepted_candidates += 1;
      tenantReport.accepted_candidates += 1;
      acceptedCandidates.push({ target, tenantReport, candidate: normalized });
    } else {
      const classification = classifyNonAccepted(status, validation || {});
      incrementCounter(report.classifications, classification);
      if (classification === "rejected_candidate") {
        report.rejected_candidates += 1;
        tenantReport.rejected_candidates += 1;
      } else {
        report.quarantine_candidates += 1;
        tenantReport.quarantine_candidates += 1;
      }
      recordSample(report, tenantReport, normalized, classification, validation?.error || classification);
    }
  }
  await inspectDetailCandidates(report, tenantReport, evaluatedCandidates, options);
}

async function classifyAccepted(pool, source, acceptedCandidates, report) {
  if (!acceptedCandidates.length) return;
  const existingRows = await getExistingRowsForCandidates(pool, source, acceptedCandidates.map((item) => item.candidate));
  const lookup = buildExistingLookup(existingRows);
  const seen = { sourceJobKeys: new Set(), urlKeys: new Set() };
  for (const item of acceptedCandidates) {
    const result = classifyCandidateAgainstExisting(item.candidate, lookup, seen);
    incrementCounter(report.classifications, result.classification);
    if (result.classification === "net_new_clean_public_candidate") {
      report.net_new_clean_candidates += 1;
      item.tenantReport.net_new_clean_candidates += 1;
      markCandidateSeen(item.candidate, seen);
    } else if ([
      "already_public_same_source_job_id",
      "already_public_same_canonical_url",
      "already_indexable_duplicate"
    ].includes(result.classification)) {
      report.duplicates += 1;
      item.tenantReport.duplicates += 1;
    } else if (result.classification === "existing_public_update_candidate") {
      report.existing_public_update_candidates += 1;
      item.tenantReport.existing_public_update_candidates += 1;
    } else if (result.classification === "stale_or_hidden_reactivation_candidate") {
      report.stale_or_hidden_reactivation_candidates += 1;
      item.tenantReport.stale_or_hidden_reactivation_candidates += 1;
    }
    recordSample(report, item.tenantReport, item.candidate, result.classification, result.reason);
  }
}

function summarizeBestMethod(tenantReport) {
  const methods = tenantReport.detail_methods || {};
  if (methods.labeled_location > 0 || methods.labeled_remote_or_work_type > 0 || methods.labeled_posting_date > 0) {
    return "labeled_detail_html";
  }
  if (methods.json_ld_jobposting > 0) return "json_ld";
  if (methods.embedded_json > 0) return "embedded_json";
  if (tenantReport.accepted_candidates > 0 || tenantReport.rows_parsed > 0) return "list_only";
  return "unsupported_html_shape";
}

function pushUnique(list, value) {
  const normalized = clean(value, 240);
  if (normalized && !list.includes(normalized)) list.push(normalized);
}

function finalizeTenantReport(tenantReport) {
  const bestMethod = summarizeBestMethod(tenantReport);
  tenantReport.best_method = bestMethod;
  if (tenantReport.detail_fetch_needed && tenantReport.detail_methods.attempted === 0) {
    pushUnique(tenantReport.expected_parser_changes_required, "add_detail_route_sampling_for_list_rows_missing_geo_or_remote");
  }
  if (tenantReport.missing_geo_candidates > 0 && tenantReport.detail_methods.labeled_location === 0 && tenantReport.detail_methods.json_ld_jobposting === 0) {
    pushUnique(tenantReport.expected_parser_changes_required, "detail_geo_parser_needs_structured_or_labeled_location");
  }
  if (tenantReport.weak_unknown_remote_candidates > 0 && tenantReport.detail_methods.labeled_remote_or_work_type === 0) {
    pushUnique(tenantReport.expected_parser_changes_required, "detail_remote_parser_needs_explicit_remote_or_work_type_label");
  }
  if (tenantReport.rows_parsed === 0) {
    pushUnique(tenantReport.expected_parser_changes_required, "source_html_shape_not_supported");
  }
  if (tenantReport.detail_methods.canonical_url_or_source_id === 0 && tenantReport.rows_parsed > 0) {
    pushUnique(tenantReport.expected_parser_changes_required, "verify_stable_source_id_or_canonical_url_from_detail");
  }
  return tenantReport;
}

function buildMethodSummary(report) {
  const tenants = report.tenant_reports.map(finalizeTenantReport);
  const bestMethodByTenant = tenants.map((tenant) => ({
    tenant_host: tenant.tenant_host,
    company: tenant.company,
    best_method: tenant.best_method,
    net_new_clean_candidates: tenant.net_new_clean_candidates,
    missing_geo_candidates: tenant.missing_geo_candidates,
    weak_unknown_remote_candidates: tenant.weak_unknown_remote_candidates,
    no_geo_no_remote_candidates: tenant.no_geo_no_remote_candidates
  }));
  return {
    source: report.source,
    configured_targets: report.configured_targets,
    scanned_targets: report.scanned_targets,
    target_coverage_pct: pct(report.scanned_targets, report.configured_targets),
    rows_fetched: report.rows_fetched,
    rows_parsed: report.rows_parsed,
    accepted_candidates: report.accepted_candidates,
    net_new_clean_candidates: report.net_new_clean_candidates,
    duplicates: report.duplicates,
    quality_risk: {
      no_geo_no_remote_candidates: report.no_geo_no_remote_candidates,
      missing_geo_candidates: report.missing_geo_candidates,
      weak_unknown_remote_candidates: report.weak_unknown_remote_candidates
    },
    best_method_by_tenant: bestMethodByTenant,
    highest_yield_tenants: [...tenants]
      .sort((a, b) => Number(b.net_new_clean_candidates || 0) - Number(a.net_new_clean_candidates || 0))
      .slice(0, 25)
      .map((tenant) => ({
        tenant_host: tenant.tenant_host,
        company: tenant.company,
        target_url: tenant.target_url,
        best_method: tenant.best_method,
        rows_parsed: tenant.rows_parsed,
        net_new_clean_candidates: tenant.net_new_clean_candidates,
        missing_geo_candidates: tenant.missing_geo_candidates,
        weak_unknown_remote_candidates: tenant.weak_unknown_remote_candidates,
        no_geo_no_remote_candidates: tenant.no_geo_no_remote_candidates,
        parser_failure_reasons: tenant.parser_failure_reasons
      })),
    tenants_blocked_by_no_detail_route: tenants
      .filter((tenant) => tenant.detail_fetch_needed && tenant.detail_methods.attempted === 0)
      .map((tenant) => tenant.tenant_host),
    tenants_blocked_by_unsupported_html_shape: tenants
      .filter((tenant) => tenant.rows_fetched > 0 && tenant.rows_parsed === 0)
      .map((tenant) => tenant.tenant_host),
    tenants_blocked_by_no_explicit_remote_evidence: tenants
      .filter((tenant) => tenant.weak_unknown_remote_candidates > 0 && tenant.detail_methods.labeled_remote_or_work_type === 0)
      .slice(0, 50)
      .map((tenant) => tenant.tenant_host),
    tenants_blocked_by_missing_structured_geo: tenants
      .filter((tenant) => tenant.missing_geo_candidates > 0 && tenant.detail_methods.labeled_location === 0 && tenant.detail_methods.json_ld_jobposting === 0)
      .slice(0, 50)
      .map((tenant) => tenant.tenant_host),
    expected_parser_changes_required: Array.from(new Set(tenants.flatMap((tenant) => tenant.expected_parser_changes_required))).sort()
  };
}

function finalizeReport(report) {
  report.classifications = {
    ...createEmptyClassificationCounts(),
    ...(report.classifications || {})
  };
  const inventory = summarizeInventory({
    configuredTargets: report.configured_targets,
    targetsScanned: report.scanned_targets,
    requestedLimit: report.requested_company_limit,
    effectiveLimit: report.effective_company_limit,
    offset: report.offset
  });
  report.inventory = inventory;
  report.duplicates = Number(report.classifications.already_public_same_source_job_id || 0)
    + Number(report.classifications.already_public_same_canonical_url || 0)
    + Number(report.classifications.already_indexable_duplicate || 0);
  report.method_summary = buildMethodSummary(report);
  return report;
}

async function runMethodExperiment(options = {}, env = process.env) {
  const source = normalizeAtsKey(options.source);
  if (!source) throw new Error("--source=<ats> is required");
  if (!ALLOWED_EXPERIMENT_SOURCES.has(source) && !options.allowUnsupportedSource) {
    throw new Error(`ats:method:experiment is scoped to ${Array.from(ALLOWED_EXPERIMENT_SOURCES).join(", ")} in this task`);
  }
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
  const acceptedCandidates = [];

  try {
    if (!options.pool) {
      lock = await acquireHeavyJobLock(pool, `ats-method-experiment-${source}`);
    }
    report.configured_targets = options.configuredTargets !== undefined
      ? Number(options.configuredTargets || 0)
      : await countConfiguredTargets(pool, source, options);
    const targets = options.targets || await discoverSourceTargets(pool, { ...options, source, limit: options.limit });
    report.scanned_targets = targets.length;
    report.source_host_count = new Set(targets.map((target) => target.host || hostFromUrl(target.companyUrl)).filter(Boolean)).size;
    await runWithLimitedConcurrency(
      targets,
      (target) => processTarget(target, { ...options, source }, report, acceptedCandidates),
      options
    );
    await classifyAccepted(pool, source, acceptedCandidates, report);
    if (lock) await lock.release("succeeded");
    lock = null;
    return finalizeReport(report);
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

function writeMethodExperimentOutput(report, outputPath) {
  if (!outputPath) return;
  const resolved = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`);
}

module.exports = {
  ALLOWED_EXPERIMENT_SOURCES,
  inspectDetailHtml,
  parseMethodExperimentArgs,
  runMethodExperiment,
  writeMethodExperimentOutput
};
