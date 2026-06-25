const fs = require("fs");
const path = require("path");
const { createPostgresPool } = require("../../backends/postgres");
const { acquireHeavyJobLock } = require("../../backends/heavyJobLock");
const { openSqliteReadOnly } = require("../dataQualityAudit");
const { buildStoredQualityFields, parseQualityFlags } = require("../dataQuality");
const { safeFetch } = require("../safeFetch");
const {
  normalizePosting,
  normalizePostingValue
} = require("../posting");
const {
  buildApplitrackDetailUrl,
  extractApplitrackDetailFields
} = require("../sources/applitrack/parse");
const {
  extractIcimsLocationFromHtml,
  extractIcimsPostingDateFromHtml,
  extractIcimsRemoteTypeFromHtml
} = require("../sources/icims/parse");

const DETAIL_REFETCH_SCHEMA_VERSION = "detail-refetch-audit-v1";
const SUPPORTED_SOURCES = new Set(["icims", "applitrack", "taleo", "talentreef", "zoho", "greenhouse", "lever", "ashby", "bamboohr", "gem", "workday", "oracle", "rippling", "applytojob", "breezy", "hrmdirect", "freshteam"]);
const WRITABLE_FIELDS = Object.freeze([
  "location_text",
  "country",
  "region",
  "city",
  "remote_type",
  "source_job_id",
  "posting_date",
  "posted_at_epoch",
  "department",
  "quality_flags",
  "quality_score",
  "description_plain",
  "description_html"
]);
const EXPLICIT_REMOTE_TYPES = new Set(["remote", "hybrid", "onsite"]);
const DEFAULT_LIMIT = 50;
const DEFAULT_COMPANY_LIMIT = 5;
const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_DELAY_MS = 1200;
const DEFAULT_JITTER_MS = 350;
const DEFAULT_TIMEOUT_MS = 15000;

function clean(value) {
  return String(value ?? "").trim();
}

function norm(value) {
  return clean(value).toLowerCase();
}

function isBlank(value) {
  const valueNorm = norm(value);
  return !valueNorm || ["unknown", "n/a", "na", "none", "null", "undefined", "not available", "not specified"].includes(valueNorm);
}

function isWeakRemoteType(value) {
  return !EXPLICIT_REMOTE_TYPES.has(norm(value));
}

function asInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function parseJsonMaybe(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function createRunId(prefix = "detail-refetch") {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function parseArgs(argv = []) {
  const options = {
    sources: [],
    limit: DEFAULT_LIMIT,
    companyLimit: DEFAULT_COMPANY_LIMIT,
    sample: 10,
    json: false,
    output: "",
    apply: false,
    confirmProduction: false,
    backupConfirmed: false,
    maxUpdates: 0,
    batchSize: DEFAULT_BATCH_SIZE,
    continueOnError: false,
    resumeRunId: "",
    operator: "",
    delayMs: DEFAULT_DELAY_MS,
    jitterMs: DEFAULT_JITTER_MS,
    timeoutMs: DEFAULT_TIMEOUT_MS
  };

  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--confirm-production") options.confirmProduction = true;
    else if (arg === "--backup-confirmed") options.backupConfirmed = true;
    else if (arg === "--continue-on-error") options.continueOnError = true;
    else if (arg.startsWith("--source=")) {
      const source = norm(arg.slice("--source=".length));
      if (source) options.sources.push(source);
    } else if (arg.startsWith("--limit=")) options.limit = Math.max(1, asInt(arg.slice("--limit=".length), DEFAULT_LIMIT));
    else if (arg.startsWith("--company-limit=")) options.companyLimit = Math.max(1, asInt(arg.slice("--company-limit=".length), DEFAULT_COMPANY_LIMIT));
    else if (arg.startsWith("--sample=")) options.sample = Math.max(0, asInt(arg.slice("--sample=".length), 10));
    else if (arg.startsWith("--output=")) options.output = clean(arg.slice("--output=".length));
    else if (arg.startsWith("--max-updates=")) options.maxUpdates = Math.max(0, asInt(arg.slice("--max-updates=".length), 0));
    else if (arg.startsWith("--batch-size=")) options.batchSize = Math.max(1, asInt(arg.slice("--batch-size=".length), DEFAULT_BATCH_SIZE));
    else if (arg.startsWith("--resume-run-id=")) options.resumeRunId = clean(arg.slice("--resume-run-id=".length));
    else if (arg.startsWith("--operator=")) options.operator = clean(arg.slice("--operator=".length));
    else if (arg.startsWith("--delay-ms=")) options.delayMs = Math.max(0, asInt(arg.slice("--delay-ms=".length), DEFAULT_DELAY_MS));
    else if (arg.startsWith("--jitter-ms=")) options.jitterMs = Math.max(0, asInt(arg.slice("--jitter-ms=".length), DEFAULT_JITTER_MS));
    else if (arg.startsWith("--timeout-ms=")) options.timeoutMs = Math.max(1000, asInt(arg.slice("--timeout-ms=".length), DEFAULT_TIMEOUT_MS));
    else if (arg.startsWith("--fixture-dir=")) options.fixtureDir = clean(arg.slice("--fixture-dir=".length));
  }

  options.sources = Array.from(new Set((options.sources.length ? options.sources : ["icims", "applitrack", "taleo", "talentreef", "zoho", "greenhouse", "lever", "ashby", "bamboohr", "gem", "workday"])
    .filter((source) => SUPPORTED_SOURCES.has(source))));
  return options;
}

function getSafetyGate(options = {}) {
  return {
    apply_requested: Boolean(options.apply),
    authorized: Boolean(options.apply && options.confirmProduction && options.backupConfirmed && Number(options.maxUpdates || 0) > 0),
    required_flags: ["--apply", "--confirm-production", "--backup-confirmed", "--max-updates=N"],
    present: {
      apply: Boolean(options.apply),
      confirm_production: Boolean(options.confirmProduction),
      backup_confirmed: Boolean(options.backupConfirmed),
      max_updates: Number(options.maxUpdates || 0)
    }
  };
}

function safeUrl(value) {
  try {
    const parsed = new URL(clean(value));
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function getHost(value) {
  return safeUrl(value)?.hostname.toLowerCase() || "";
}

function canonicalUrlForRow(row) {
  return clean(row?.canonical_url || row?.job_posting_url || row?.apply_url);
}

function extractSourceJobIdFromUrl(row) {
  const existing = normalizePostingValue(row?.source_job_id);
  if (existing) return existing;
  const url = canonicalUrlForRow(row);
  const parsed = safeUrl(url);
  if (!parsed) return "";
  const atsKey = norm(row?.ats_key || row?.source_ats);
  if (atsKey === "icims") return parsed.pathname.match(/\/jobs\/(\d+)/i)?.[1] || "";
  if (atsKey === "applitrack") {
    return clean(parsed.searchParams.get("JobID") || parsed.searchParams.get("jobid") || parsed.searchParams.get("AppliTrackJobId"));
  }
  if (atsKey === "taleo") {
    return clean(parsed.searchParams.get("job") || parsed.searchParams.get("jobid") || "");
  }
  if (atsKey === "talentreef") {
    return parsed.pathname.match(/\/jobs\/([^\/]+)/i)?.[1] || "";
  }
  if (atsKey === "zoho") {
    return parsed.pathname.split("/").filter(Boolean).pop() || "";
  }
  try {
    const { extractSourceIdFromPostingUrl } = require("../parsers/shared/sourceIds");
    return extractSourceIdFromPostingUrl(url, atsKey);
  } catch {
    return "";
  }
}

function applitrackSiteRootFromUrl(urlValue) {
  const parsed = safeUrl(urlValue);
  if (!parsed) return "";
  const pathValue = String(parsed.pathname || "");
  const lowerPath = pathValue.toLowerCase();
  const onlineAppIndex = lowerPath.indexOf("/onlineapp/");
  if (onlineAppIndex >= 0) {
    return `${parsed.protocol}//${parsed.host}${pathValue.slice(0, onlineAppIndex + "/onlineapp/".length)}`;
  }
  const defaultIndex = lowerPath.indexOf("default.aspx");
  if (defaultIndex >= 0) {
    const rootPath = pathValue.slice(0, defaultIndex);
    return `${parsed.protocol}//${parsed.host}${rootPath.endsWith("/") ? rootPath : `${rootPath}/`}`;
  }
  return `${parsed.protocol}//${parsed.host}/onlineapp/`;
}

function detailUrlForRow(row) {
  const url = canonicalUrlForRow(row);
  if (!url) return "";
  const atsKey = norm(row?.ats_key || row?.source_ats);
  if (atsKey === "icims") {
    const parsed = safeUrl(url);
    if (!parsed) return "";
    parsed.searchParams.set("in_iframe", "1");
    return parsed.toString();
  }
  if (atsKey === "applitrack") {
    return buildApplitrackDetailUrl(applitrackSiteRootFromUrl(url), extractSourceJobIdFromUrl(row), url);
  }
  if (["taleo", "talentreef", "zoho", "greenhouse", "lever", "ashby", "bamboohr", "gem", "workday", "oracle", "rippling", "applytojob", "breezy", "hrmdirect", "freshteam", "recruitcrm"].includes(atsKey)) {
    return url;
  }
  return "";
}

function isAllowedDetailUrl(atsKey, urlValue) {
  const parsed = safeUrl(urlValue);
  if (!parsed) return false;
  const hostname = parsed.hostname.toLowerCase();
  if (atsKey === "icims") return hostname.endsWith(".icims.com");
  if (atsKey === "applitrack") return hostname.endsWith(".applitrack.com");
  if (atsKey === "taleo") return hostname.endsWith(".taleo.net") || hostname.endsWith(".oraclecloud.com");
  if (atsKey === "talentreef") return hostname.endsWith(".jobappnetwork.com") || hostname.endsWith(".talentreef.com");
  if (atsKey === "zoho") return hostname.endsWith(".zohorecruit.com") || hostname.endsWith(".zoho.com");
  if (atsKey === "greenhouse") return hostname.endsWith(".greenhouse.io") || hostname.endsWith(".greenhouse.co");
  if (atsKey === "lever") return hostname.endsWith(".lever.co");
  if (atsKey === "ashby") return hostname.endsWith(".ashbyhq.com");
  if (atsKey === "bamboohr") return hostname.endsWith(".bamboohr.com");
  if (atsKey === "gem") return hostname.endsWith(".jobs.gem.com") || hostname.endsWith(".gem.com");
  if (atsKey === "workday") return hostname.endsWith(".myworkdayjobs.com");
  if (atsKey === "oracle") return hostname.endsWith(".oraclecloud.com");
  if (atsKey === "rippling") return hostname.endsWith(".rippling.com");
  if (atsKey === "applytojob") return hostname.endsWith(".applytojob.com");
  if (atsKey === "breezy") return hostname.endsWith(".breezy.hr");
  if (atsKey === "hrmdirect") return hostname.endsWith(".hrmdirect.com");
  if (atsKey === "freshteam") return hostname.endsWith(".freshteam.com");
  if (atsKey === "recruitcrm") return hostname.endsWith(".recruitcrm.io") || hostname === "recruitcrm.io";
  return false;
}

function rowHasMissingGeo(row) {
  return isBlank(row?.country) || isBlank(row?.region) || isBlank(row?.city) || isBlank(row?.location_text);
}

function rowHasMissingAllGeo(row) {
  return isBlank(row?.country) && isBlank(row?.region) && isBlank(row?.city);
}

function isCandidateRow(row) {
  const atsKey = norm(row?.ats_key || row?.source_ats);
  if (!SUPPORTED_SOURCES.has(atsKey)) return { ok: false, reason: "unsupported_source" };
  if (Boolean(row?.hidden) || Number(row?.hidden || 0) === 1) return { ok: false, reason: "hidden" };
  if (!canonicalUrlForRow(row)) return { ok: false, reason: "missing_url" };
  if (!rowHasMissingGeo(row) && !isWeakRemoteType(row?.remote_type) && row?.description_plain && row?.description_plain.trim().length > 0) return { ok: false, reason: "already_complete" };
  const detailUrl = detailUrlForRow(row);
  if (!detailUrl) return { ok: false, reason: "missing_detail_url" };
  return { ok: true, reason: "" };
}

function capRowsByCompany(rows, companyLimit) {
  const counts = new Map();
  const capped = [];
  for (const row of rows) {
    const key = `${norm(row.ats_key)}:${getHost(canonicalUrlForRow(row)) || clean(row.company_name) || "unknown"}`;
    const current = counts.get(key) || 0;
    if (current >= companyLimit) continue;
    counts.set(key, current + 1);
    capped.push(row);
  }
  return capped;
}

function summarizeCandidates(rows, options = {}) {
  const sampleLimit = Math.max(0, Number(options.sample || 0));
  const summary = {
    total_candidates: rows.length,
    by_source: {},
    by_host: {},
    rows_requiring_icims_detail_refetch: 0,
    rows_requiring_applitrack_detail_refetch: 0,
    rows_requiring_taleo_detail_refetch: 0,
    rows_requiring_talentreef_detail_refetch: 0,
    rows_requiring_zoho_detail_refetch: 0,
    samples: []
  };
  for (const row of rows) {
    const source = norm(row.ats_key || row.source_ats) || "unknown";
    const host = getHost(canonicalUrlForRow(row)) || "unknown";
    summary.by_source[source] = (summary.by_source[source] || 0) + 1;
    summary.by_host[host] = (summary.by_host[host] || 0) + 1;
    if (source === "icims") summary.rows_requiring_icims_detail_refetch += 1;
    if (source === "applitrack") summary.rows_requiring_applitrack_detail_refetch += 1;
    if (source === "taleo") summary.rows_requiring_taleo_detail_refetch += 1;
    if (source === "talentreef") summary.rows_requiring_talentreef_detail_refetch += 1;
    if (source === "zoho") summary.rows_requiring_zoho_detail_refetch += 1;
    if (summary.samples.length < sampleLimit) {
      summary.samples.push({
        source_ats: source,
        company_name: clean(row.company_name),
        title: clean(row.position_name),
        canonical_url: canonicalUrlForRow(row),
        detail_url: detailUrlForRow(row),
        missing_all_geo: rowHasMissingAllGeo(row),
        weak_remote_type: isWeakRemoteType(row.remote_type)
      });
    }
  }
  return summary;
}

function extractJsonLdObjectsFromHtml(html) {
  const objects = [];
  if (!html) return objects;
  const regex = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const jsonText = match[1].trim();
    if (!jsonText) continue;
    try {
      const cleaned = jsonText
        .replace(/^\s*<!--/, "")
        .replace(/-->\s*$/, "")
        .trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        objects.push(...parsed);
      } else if (parsed && typeof parsed === "object") {
        objects.push(parsed);
      }
    } catch {
      // Ignore parse errors from malformed JSON-LD in target pages
    }
  }
  return objects;
}

function extractTagContent(html, startPattern) {
  const match = html.match(startPattern);
  if (!match) return null;
  const startIdx = match.index;
  const tagOpenIdx = startIdx + match[0].length;

  const tagNameMatch = match[0].match(/^<([a-z0-9]+)/i);
  if (!tagNameMatch) return null;
  const tagName = tagNameMatch[1].toLowerCase();

  let depth = 1;
  const tagPattern = new RegExp(`<\\/?${tagName}\\b[^>]*>`, "gi");
  tagPattern.lastIndex = tagOpenIdx;

  let tagMatch;
  while ((tagMatch = tagPattern.exec(html)) !== null) {
    const matchedTag = tagMatch[0];
    if (matchedTag.startsWith("</")) {
      depth--;
    } else if (!matchedTag.endsWith("/>")) {
      depth++;
    }

    if (depth === 0) {
      const endIdx = tagMatch.index;
      return html.slice(tagOpenIdx, endIdx).trim();
    }
  }

  return html.slice(tagOpenIdx, tagOpenIdx + 15000).trim();
}

function extractDescriptionFromHtml(html) {
  if (!html) return null;

  const patterns = [
    /<(?:div|section|span)\b[^>]*class=["']?[^"']*\bjob-details-content\b[^"']*["']?[^>]*>/i,
    /<(?:div|section|span)\b[^>]*class=["']?[^"']*\bjob__description\b[^"']*["']?[^>]*>/i,
    /<(?:div|section|span)\b[^>]*id=["']?[^"']*\bjob__description\b[^"']*["']?[^>]*>/i,
    /<(?:div|section|span)\b[^>]*class=["']?[^"']*\bjob-description\b[^"']*["']?[^>]*>/i,
    /<(?:div|section|span)\b[^>]*id=["']?[^"']*\bjob-description\b[^"']*["']?[^>]*>/i,
    /<(?:div|section|span)\b[^>]*class=["']?[^"']*\bjobDesc\b[^"']*["']?[^>]*>/i,
    /<(?:div|section|span)\b[^>]*class=["']?[^"']*\bjobdesc\b[^"']*["']?[^>]*>/i,
    /<(?:div|section|span)\b[^>]*class=["']?[^"']*\bjobDetail\b[^"']*["']?[^>]*>/i,
    /<(?:div|section|span)\b[^>]*class=["']?[^"']*\bjobdetail\b[^"']*["']?[^>]*>/i,
    /<(?:div|section|span)\b[^>]*class=["']?[^"']*\breqDescription\b[^"']*["']?[^>]*>/i,
    /<(?:div|section|span)\b[^>]*class=["']?[^"']*\breqdescription\b[^"']*["']?[^>]*>/i,
    /<(?:div|section|span)\b[^>]*class=["']?[^"']*\bdescription\b[^"']*["']?[^>]*>/i,
    /<(?:div|section|span)\b[^>]*id=["']?[^"']*\bdescription\b[^"']*["']?[^>]*>/i,
    /<(?:div|section|span)\b[^>]*id=["']?content["']?[^>]*>/i
  ];

  for (const pattern of patterns) {
    const innerHtml = extractTagContent(html, pattern);
    if (innerHtml && innerHtml.length > 100) {
      return {
        description_html: innerHtml,
        description_plain: htmlToText(innerHtml)
      };
    }
  }

  return null;
}

function extractFieldsFromJsonLd(html, row) {
  const objects = extractJsonLdObjectsFromHtml(html);
  const jobPosting = objects.find(obj => {
    const type = String(obj?.["@type"] || "").toLowerCase();
    return type === "jobposting" || type.includes("jobposting");
  });

  if (!jobPosting) {
    return {};
  }

  const detail = {};

  const loc = jobPosting.jobLocation;
  if (loc) {
    const address = Array.isArray(loc) ? loc[0]?.address : loc.address;
    if (address) {
      const parts = [];
      if (address.streetAddress) parts.push(clean(address.streetAddress));
      if (address.addressLocality) parts.push(clean(address.addressLocality));
      if (address.addressRegion) parts.push(clean(address.addressRegion));
      if (address.addressCountry) {
        const country = clean(address.addressCountry);
        if (typeof address.addressCountry === "object") {
          parts.push(clean(address.addressCountry.name || address.addressCountry.code));
        } else {
          parts.push(country);
        }
      }
      if (parts.length > 0) {
        detail.location = parts.join(", ");
      }
    }
  }

  if (jobPosting.datePosted) {
    detail.posting_date = clean(jobPosting.datePosted);
  }

  const locType = String(jobPosting.jobLocationType || "").toLowerCase();
  const desc = String(jobPosting.description || "").toLowerCase();
  if (locType.includes("telecommute") || desc.includes("telecommute")) {
    detail.remote_type = "remote";
  } else if (desc.includes("work from home") || desc.includes("wfh") || desc.includes("remote option")) {
    detail.remote_type = "remote";
  }

  if (jobPosting.department) {
    detail.department = clean(jobPosting.department.name || jobPosting.department);
  } else if (jobPosting.industry) {
    detail.department = clean(jobPosting.industry);
  }

  if (jobPosting.description) {
    detail.description_html = clean(jobPosting.description);
    detail.description_plain = htmlToText(jobPosting.description);
  }

  return detail;
}

function extractDetailFields(row, html) {
  const atsKey = norm(row?.ats_key || row?.source_ats);
  let detail = {};
  if (atsKey === "icims") {
    detail = {
      location: extractIcimsLocationFromHtml(html),
      posting_date: extractIcimsPostingDateFromHtml(html),
      remote_type: extractIcimsRemoteTypeFromHtml(html),
      source_job_id: extractSourceJobIdFromUrl(row)
    };
  } else if (atsKey === "applitrack") {
    const applitrackDetail = extractApplitrackDetailFields(html);
    const explicitRemote = extractRemoteLabelFromHtml(html);
    detail = {
      ...applitrackDetail,
      remote_type: explicitRemote || applitrackDetail.remote_type,
      source_job_id: extractSourceJobIdFromUrl(row)
    };
  } else if (["taleo", "talentreef", "zoho", "greenhouse", "lever", "ashby", "bamboohr", "gem", "workday", "oracle", "rippling", "applytojob", "breezy", "hrmdirect", "freshteam", "recruitcrm"].includes(atsKey)) {
    let sourceModule = null;
    try {
      const { getSourceModule } = require("../sources");
      sourceModule = getSourceModule(atsKey);
    } catch {}

    let customExtract = null;
    if (sourceModule) {
      const keys = Object.keys(sourceModule);
      const matchKey = keys.find(k => 
        typeof sourceModule[k] === "function" && 
        k.toLowerCase() === `extract${atsKey}detailfields`
      );
      if (matchKey) {
        customExtract = sourceModule[matchKey];
      }
    }

    if (customExtract) {
      try {
        const customDetail = customExtract(html);
        detail = {
          ...customDetail,
          source_job_id: extractSourceJobIdFromUrl(row)
        };
      } catch (err) {
        detail = extractFieldsFromJsonLd(html, row);
      }
    } else {
      detail = extractFieldsFromJsonLd(html, row);
    }

    if (!detail.remote_type) {
      detail.remote_type = extractRemoteLabelFromHtml(html);
    }
    detail.source_job_id = extractSourceJobIdFromUrl(row);
  }

  if (detail && !detail.description_plain) {
    const desc = extractDescriptionFromHtml(html);
    if (desc) {
      detail.description_html = desc.description_html;
      detail.description_plain = desc.description_plain;
    }
  }

  return detail;
}

function htmlToText(sourceHtml) {
  return String(sourceHtml || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:tr|td|th|div|p|li|span)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractRemoteLabelFromHtml(sourceHtml) {
  const text = htmlToText(sourceHtml);
  const labelMatch = text.match(/\b(?:Remote|Work Location Type|Work Type)\s*:?\s*(Hybrid|Remote|On[- ]?site|Onsite|Primarily Remote|Telework|Work from Home|WFH)\b/i);
  const value = norm(labelMatch?.[1]);
  if (!value) return "";
  if (value.includes("hybrid")) return "hybrid";
  if (value.includes("remote") || value.includes("telework") || value === "wfh" || value.includes("work from home")) return "remote";
  if (value.includes("onsite") || value.includes("on-site")) return "onsite";
  return "";
}

function buildNormalizedFromDetail(row, detail) {
  const atsKey = norm(row?.ats_key || row?.source_ats);
  const nextRemote =
    isWeakRemoteType(row?.remote_type) && EXPLICIT_REMOTE_TYPES.has(norm(detail?.remote_type))
      ? norm(detail.remote_type)
      : clean(row?.remote_type || "unknown") || "unknown";
  const evidenceLocation = clean(detail?.location) || clean(row.location_text);
  const normalized = normalizePosting(
    {
      ...row,
      company_name: clean(row.company_name || row.company),
      position_name: clean(row.position_name || row.title),
      job_posting_url: canonicalUrlForRow(row),
      apply_url: clean(row.apply_url) || canonicalUrlForRow(row),
      source_job_id: clean(row.source_job_id) || clean(detail?.source_job_id),
      location_text: evidenceLocation,
      location: evidenceLocation,
      posting_date: clean(row.posting_date) || clean(detail?.posting_date),
      remote_type: nextRemote,
      department: clean(row.department) || clean(detail?.department),
      source_evidence: {
        ...(row.source_evidence || {}),
        ...(detail.evidence || {}),
        detail_url: canonicalUrlForRow(row),
        detail_fetch_status: 200
      }
    },
    { company_name: clean(row.company_name || row.company) },
    atsKey,
    {
      parserVersion: clean(row.parser_version) || `${atsKey}-detail-refetch-v1`,
      confidence: Number(row.confidence || row.parser_confidence || 0.75) || 0.75,
      firstSeenEpoch: Number(row.first_seen_epoch || 0) || null,
      lastSeenEpoch: Number(row.last_seen_epoch || 0) || null
    }
  );
  if (EXPLICIT_REMOTE_TYPES.has(nextRemote)) {
    normalized.remote_type = nextRemote;
    normalized.is_remote = nextRemote === "remote" || nextRemote === "hybrid";
  }
  return normalized;
}

function change(field, before, after, rule, confidence, evidence) {
  return {
    field,
    before: before === null || before === undefined ? "" : String(before),
    after: after === null || after === undefined ? "" : String(after),
    rule,
    confidence,
    evidence
  };
}

function planDetailChanges(row, detail, options = {}) {
  const normalized = buildNormalizedFromDetail(row, detail);
  const changes = [];
  const evidence = clean(detail?.location || detail?.remote_type || detail?.posting_date || detail?.department).slice(0, 240);
  const confidence = Number(options.confidence || 0.78);
  const addIfBlank = (field, after, rule) => {
    const current = clean(row[field]);
    const next = clean(after);
    if (!current && next) changes.push(change(field, current, next, rule, confidence, evidence));
  };

  addIfBlank("location_text", normalized.location_text, "detail_location_text");
  addIfBlank("country", normalized.country, "detail_geo_country");
  addIfBlank("region", normalized.region, "detail_geo_region");
  addIfBlank("city", normalized.city, "detail_geo_city");
  addIfBlank("source_job_id", normalized.source_job_id, "detail_source_id");
  addIfBlank("posting_date", normalized.posting_date, "detail_posting_date");
  if (!row.posted_at_epoch && normalized.posted_at_epoch) {
    changes.push(change("posted_at_epoch", "", normalized.posted_at_epoch, "detail_posting_date_epoch", confidence, evidence));
  }
  addIfBlank("department", normalized.department, "detail_department");
  addIfBlank("description_plain", detail?.description_plain, "detail_description_plain");
  addIfBlank("description_html", detail?.description_html, "detail_description_html");

  if (isWeakRemoteType(row.remote_type) && EXPLICIT_REMOTE_TYPES.has(norm(normalized.remote_type))) {
    changes.push(change("remote_type", row.remote_type || "unknown", normalized.remote_type, "detail_remote_type", confidence, evidence));
  }

  const after = { ...row };
  for (const item of changes) after[item.field] = item.after;
  const quality = buildStoredQualityFields(after, { nowEpoch: options.nowEpoch });
  const currentFlags = JSON.stringify(parseQualityFlags(row.quality_flags));
  if (currentFlags !== quality.quality_flags) {
    changes.push(change("quality_flags", currentFlags, quality.quality_flags, "detail_quality_recompute", 0.9, "derived from stored fields after detail refetch"));
  }
  if (String(Number(row.quality_score || 0)) !== String(Number(quality.quality_score || 0))) {
    changes.push(change("quality_score", row.quality_score || 0, quality.quality_score, "detail_quality_recompute", 0.9, "derived from stored fields after detail refetch"));
  }

  return {
    row,
    detail,
    normalized,
    changes: changes.filter((item) => WRITABLE_FIELDS.includes(item.field)),
    parser_status: changes.length > 0 ? "success" : "no_supported_change",
    parser_failure_reason: ""
  };
}

function canApplyDetailPlan(plan) {
  if (!plan || !Array.isArray(plan.changes) || plan.changes.length === 0) return false;
  for (const item of plan.changes) {
    if (!WRITABLE_FIELDS.includes(item.field)) return false;
    if (["location_text", "country", "region", "city", "source_job_id", "posting_date", "department", "description_plain", "description_html"].includes(item.field) && clean(item.before)) return false;
    if (item.field === "city" && !clean(item.after)) return false;
    if (item.field === "city" && /^[A-Z]{2,3}[-\s][A-Z]{2,3}[-\s]/.test(clean(item.after))) return false;
    if (item.field === "remote_type" && (!EXPLICIT_REMOTE_TYPES.has(norm(item.after)) || EXPLICIT_REMOTE_TYPES.has(norm(item.before)))) return false;
    if (item.field === "posted_at_epoch" && Number(item.before || 0) > 0) return false;
  }
  return true;
}

async function fetchDetailHtml(row, options = {}) {
  const detailUrl = detailUrlForRow(row);
  const atsKey = norm(row.ats_key);
  if (options.detailByUrl && Object.prototype.hasOwnProperty.call(options.detailByUrl, detailUrl)) {
    return { ok: true, detailUrl, status: 200, html: String(options.detailByUrl[detailUrl] || ""), fromFixture: true };
  }
  if (options.detailByUrl && Object.prototype.hasOwnProperty.call(options.detailByUrl, canonicalUrlForRow(row))) {
    return { ok: true, detailUrl, status: 200, html: String(options.detailByUrl[canonicalUrlForRow(row)] || ""), fromFixture: true };
  }

  // Delegate to source module's fetchDetail if available and custom
  let sourceModule = null;
  try {
    const { getSourceModule } = require("../sources");
    sourceModule = getSourceModule(atsKey);
  } catch {}
  if (sourceModule && typeof sourceModule.fetchDetail === "function") {
    try {
      const result = await sourceModule.fetchDetail(row, options);
      if (result && result.html) {
        return { ok: true, detailUrl, status: result.status || 200, html: result.html };
      }
    } catch (error) {
      return {
        ok: false,
        detailUrl,
        status: error.status || 0,
        error: error.message || String(error),
        backoff_ms: Math.max(options.delayMs || DEFAULT_DELAY_MS, 5000)
      };
    }
  }
  if (options.fixtureDir) {
    const sourceId = extractSourceJobIdFromUrl(row);
    const candidates = [
      `${atsKey}-${sourceId}.html`,
      `${atsKey}-detail-${sourceId}.html`
    ].filter((name) => !name.includes(".."));
    for (const name of candidates) {
      const filePath = path.join(options.fixtureDir, name);
      if (fs.existsSync(filePath)) {
        return { ok: true, detailUrl, status: 200, html: fs.readFileSync(filePath, "utf8"), fromFixture: true };
      }
    }
  }
  if (!isAllowedDetailUrl(atsKey, detailUrl)) {
    return { ok: false, detailUrl, status: 0, error: "blocked_detail_url", backoff_ms: options.delayMs || DEFAULT_DELAY_MS };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, options.timeoutMs || DEFAULT_TIMEOUT_MS));
  try {
    const response = await safeFetch(detailUrl, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "openjobslots-detail-refetch/1.0"
      }
    });
    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        detailUrl,
        status: response.status,
        error: `http_${response.status}`,
        html_excerpt: text.slice(0, 500),
        backoff_ms: response.status === 429 || response.status >= 500 ? Math.max(options.delayMs || DEFAULT_DELAY_MS, 5000) : options.delayMs || DEFAULT_DELAY_MS
      };
    }
    return { ok: true, detailUrl, status: response.status, html: text };
  } catch (error) {
    return {
      ok: false,
      detailUrl,
      status: 0,
      error: error?.name === "AbortError" ? "timeout" : clean(error?.message || error),
      backoff_ms: Math.max(options.delayMs || DEFAULT_DELAY_MS, 5000)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

async function politeDelay(options = {}) {
  const base = Math.max(0, Number(options.delayMs || 0));
  const jitter = Math.max(0, Number(options.jitterMs || 0));
  const extra = jitter > 0 ? Math.floor(Math.random() * jitter) : 0;
  if (base + extra > 0) await sleep(base + extra);
}

function openSqliteWritable(dbPath) {
  const sqlite3 = require("sqlite3");
  const resolved = path.resolve(dbPath || "jobs.db");
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(resolved, (error) => {
      if (error) reject(error);
      else {
        resolve({
          all(sql, params = []) {
            return new Promise((innerResolve, innerReject) => {
              db.all(sql, params, (queryError, rows) => {
                if (queryError) innerReject(queryError);
                else innerResolve(rows || []);
              });
            });
          },
          run(sql, params = []) {
            return new Promise((innerResolve, innerReject) => {
              db.run(sql, params, function onRun(runError) {
                if (runError) innerReject(runError);
                else innerResolve({ changes: this.changes || 0, lastID: this.lastID || 0 });
              });
            });
          },
          exec(sql) {
            return new Promise((innerResolve, innerReject) => {
              db.exec(sql, (execError) => {
                if (execError) innerReject(execError);
                else innerResolve();
              });
            });
          },
          close() {
            return new Promise((innerResolve, innerReject) => {
              db.close((closeError) => {
                if (closeError) innerReject(closeError);
                else innerResolve();
              });
            });
          }
        });
      }
    });
  });
}

async function loadPostgresCandidates(pool, options = {}) {
  const sources = options.sources || ["icims", "applitrack"];
  const params = [sources, Math.max(1, Number(options.limit || DEFAULT_LIMIT) * Math.max(1, Number(options.companyLimit || DEFAULT_COMPANY_LIMIT)))];
  const result = await pool.query(
    `
      SELECT
        canonical_url,
        canonical_url AS row_id,
        company_name,
        position_name,
        apply_url,
        coalesce(location_text, '') AS location_text,
        coalesce(city, '') AS city,
        coalesce(country, '') AS country,
        coalesce(region, '') AS region,
        coalesce(remote_type, 'unknown') AS remote_type,
        ats_key,
        coalesce(source_job_id, '') AS source_job_id,
        posting_date,
        posted_at_epoch,
        first_seen_epoch,
        last_seen_epoch,
        hidden,
        coalesce(parser_version, 'legacy-adapter-v1') AS parser_version,
        confidence,
        coalesce(department, '') AS department,
        coalesce(quality_score, 0) AS quality_score,
        coalesce(quality_flags, '[]'::jsonb) AS quality_flags
      FROM postings
      WHERE hidden = false
        AND ats_key = ANY($1::text[])
        AND (
          coalesce(location_text, '') = ''
          OR coalesce(country, '') = ''
          OR coalesce(region, '') = ''
          OR coalesce(city, '') = ''
          OR coalesce(remote_type, 'unknown') = 'unknown'
          OR coalesce(description_plain, '') = ''
        )
      ORDER BY
        CASE WHEN coalesce(country, '') = '' AND coalesce(region, '') = '' AND coalesce(city, '') = '' AND coalesce(remote_type, 'unknown') = 'unknown' THEN 0 ELSE 1 END,
        last_seen_epoch DESC NULLS LAST,
        canonical_url ASC
      LIMIT $2;
    `,
    params
  );
  return capRowsByCompany(result.rows || [], options.companyLimit || DEFAULT_COMPANY_LIMIT)
    .slice(0, options.limit || DEFAULT_LIMIT);
}

async function loadSqliteCandidates(db, options = {}) {
  const sourceValues = options.sources || ["icims", "applitrack"];
  const sourceFilter = sourceValues.length
    ? `AND lower(coalesce(ats_key, '')) IN (${sourceValues.map(() => "?").join(", ")})`
    : "";
  const params = [...sourceValues, Math.max(1, Number(options.limit || DEFAULT_LIMIT) * Math.max(1, Number(options.companyLimit || DEFAULT_COMPANY_LIMIT)))];
  let rows;
  try {
    rows = await db.all(
      `
        SELECT
          job_posting_url AS canonical_url,
          rowid AS row_id,
          company_name,
          position_name,
          coalesce(apply_url, job_posting_url) AS apply_url,
          coalesce(location_text, location, '') AS location_text,
          coalesce(city, '') AS city,
          coalesce(country, '') AS country,
          coalesce(region, '') AS region,
          coalesce(remote_type, 'unknown') AS remote_type,
          coalesce(ats_key, '') AS ats_key,
          coalesce(source_job_id, '') AS source_job_id,
          posting_date,
          posted_at_epoch,
          first_seen_epoch,
          last_seen_epoch,
          coalesce(hidden, 0) AS hidden,
          coalesce(parser_version, 'legacy-adapter-v1') AS parser_version,
          coalesce(confidence, 0.75) AS confidence,
          coalesce(department, '') AS department,
          coalesce(quality_score, 0) AS quality_score,
          coalesce(quality_flags, '[]') AS quality_flags
        FROM Postings
        WHERE coalesce(hidden, 0) = 0
          ${sourceFilter}
          AND (
            coalesce(location_text, location, '') = ''
            OR coalesce(country, '') = ''
            OR coalesce(region, '') = ''
            OR coalesce(city, '') = ''
            OR coalesce(remote_type, 'unknown') = 'unknown'
            OR coalesce(description_plain, '') = ''
          )
        ORDER BY
          CASE WHEN coalesce(country, '') = '' AND coalesce(region, '') = '' AND coalesce(city, '') = '' AND coalesce(remote_type, 'unknown') = 'unknown' THEN 0 ELSE 1 END,
          coalesce(last_seen_epoch, 0) DESC,
          job_posting_url ASC
        LIMIT ?;
      `,
      params
    );
  } catch {
    rows = await db.all(
      `
        SELECT
          job_posting_url AS canonical_url,
          rowid AS row_id,
          company_name,
          position_name,
          job_posting_url AS apply_url,
          coalesce(location, '') AS location_text,
          '' AS city,
          '' AS country,
          '' AS region,
          'unknown' AS remote_type,
          coalesce(ats_key, '') AS ats_key,
          '' AS source_job_id,
          NULL AS posting_date,
          NULL AS posted_at_epoch,
          NULL AS first_seen_epoch,
          NULL AS last_seen_epoch,
          0 AS hidden,
          'legacy-adapter-v1' AS parser_version,
          0.75 AS confidence,
          '' AS department,
          0 AS quality_score,
          '[]' AS quality_flags
        FROM Postings
        WHERE coalesce(hidden, 0) = 0
          ${sourceFilter}
        LIMIT ?;
      `,
      params
    );
  }
  return capRowsByCompany(rows || [], options.companyLimit || DEFAULT_COMPANY_LIMIT)
    .slice(0, options.limit || DEFAULT_LIMIT);
}

async function ensureSqliteDetailRefetchSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS detail_refetch_runs (
      run_id TEXT PRIMARY KEY,
      schema_version TEXT NOT NULL,
      started_at_epoch INTEGER NOT NULL,
      completed_at_epoch INTEGER,
      operator TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      db_backend TEXT NOT NULL,
      source_filter TEXT NOT NULL DEFAULT '',
      limit_count INTEGER NOT NULL DEFAULT 0,
      company_limit INTEGER NOT NULL DEFAULT 0,
      max_updates INTEGER NOT NULL DEFAULT 0,
      batch_size INTEGER NOT NULL DEFAULT 0,
      checkpoint_url TEXT NOT NULL DEFAULT '',
      http_status_counts TEXT NOT NULL DEFAULT '{}',
      parser_success_count INTEGER NOT NULL DEFAULT 0,
      parser_failure_count INTEGER NOT NULL DEFAULT 0,
      retry_policy TEXT NOT NULL DEFAULT '{}',
      dry_run_summary TEXT NOT NULL DEFAULT '{}',
      error TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS detail_refetch_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      changed_at_epoch INTEGER NOT NULL,
      row_identifier TEXT NOT NULL DEFAULT '',
      source_ats TEXT NOT NULL DEFAULT '',
      source_company TEXT NOT NULL DEFAULT '',
      canonical_url TEXT NOT NULL DEFAULT '',
      detail_url TEXT NOT NULL DEFAULT '',
      http_status INTEGER NOT NULL DEFAULT 0,
      field_name TEXT NOT NULL DEFAULT '',
      old_value TEXT NOT NULL DEFAULT '',
      new_value TEXT NOT NULL DEFAULT '',
      rule_name TEXT NOT NULL DEFAULT '',
      confidence REAL NOT NULL DEFAULT 0,
      source_evidence_summary TEXT NOT NULL DEFAULT '',
      reversible_metadata TEXT NOT NULL DEFAULT '{}',
      parser_status TEXT NOT NULL DEFAULT '',
      parser_failure_reason TEXT NOT NULL DEFAULT '',
      applied INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(run_id) REFERENCES detail_refetch_runs(run_id)
    );

    CREATE INDEX IF NOT EXISTS idx_detail_refetch_changes_run
      ON detail_refetch_changes(run_id, id);
    CREATE INDEX IF NOT EXISTS idx_detail_refetch_changes_url
      ON detail_refetch_changes(canonical_url, field_name);
  `);
}

async function ensurePostgresDetailRefetchSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS detail_refetch_runs (
      run_id TEXT PRIMARY KEY,
      schema_version TEXT NOT NULL,
      started_at_epoch BIGINT NOT NULL,
      completed_at_epoch BIGINT,
      operator TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      db_backend TEXT NOT NULL,
      source_filter TEXT NOT NULL DEFAULT '',
      limit_count INTEGER NOT NULL DEFAULT 0,
      company_limit INTEGER NOT NULL DEFAULT 0,
      max_updates INTEGER NOT NULL DEFAULT 0,
      batch_size INTEGER NOT NULL DEFAULT 0,
      checkpoint_url TEXT NOT NULL DEFAULT '',
      http_status_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
      parser_success_count INTEGER NOT NULL DEFAULT 0,
      parser_failure_count INTEGER NOT NULL DEFAULT 0,
      retry_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
      dry_run_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      error TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS detail_refetch_changes (
      id BIGSERIAL PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES detail_refetch_runs(run_id),
      changed_at_epoch BIGINT NOT NULL,
      row_identifier TEXT NOT NULL DEFAULT '',
      source_ats TEXT NOT NULL DEFAULT '',
      source_company TEXT NOT NULL DEFAULT '',
      canonical_url TEXT NOT NULL DEFAULT '',
      detail_url TEXT NOT NULL DEFAULT '',
      http_status INTEGER NOT NULL DEFAULT 0,
      field_name TEXT NOT NULL DEFAULT '',
      old_value TEXT NOT NULL DEFAULT '',
      new_value TEXT NOT NULL DEFAULT '',
      rule_name TEXT NOT NULL DEFAULT '',
      confidence REAL NOT NULL DEFAULT 0,
      source_evidence_summary TEXT NOT NULL DEFAULT '',
      reversible_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      parser_status TEXT NOT NULL DEFAULT '',
      parser_failure_reason TEXT NOT NULL DEFAULT '',
      applied BOOLEAN NOT NULL DEFAULT false
    );

    CREATE INDEX IF NOT EXISTS idx_detail_refetch_changes_run
      ON detail_refetch_changes(run_id, id);
    CREATE INDEX IF NOT EXISTS idx_detail_refetch_changes_url
      ON detail_refetch_changes(canonical_url, field_name);
  `);
}

async function insertSqliteRun(db, run, summary) {
  await db.run(
    `
      INSERT INTO detail_refetch_runs (
        run_id, schema_version, started_at_epoch, operator, mode, status, db_backend,
        source_filter, limit_count, company_limit, max_updates, batch_size,
        retry_policy, dry_run_summary
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET status = excluded.status
    `,
    [
      run.runId,
      DETAIL_REFETCH_SCHEMA_VERSION,
      run.startedAtEpoch,
      run.operator,
      run.mode,
      run.status,
      run.dbBackend,
      run.sourceFilter,
      run.limit,
      run.companyLimit,
      run.maxUpdates,
      run.batchSize,
      JSON.stringify(run.retryPolicy),
      JSON.stringify(summary || {})
    ]
  );
}

async function insertPostgresRun(pool, run, summary) {
  await pool.query(
    `
      INSERT INTO detail_refetch_runs (
        run_id, schema_version, started_at_epoch, operator, mode, status, db_backend,
        source_filter, limit_count, company_limit, max_updates, batch_size,
        retry_policy, dry_run_summary
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb)
      ON CONFLICT(run_id) DO UPDATE SET status = excluded.status
    `,
    [
      run.runId,
      DETAIL_REFETCH_SCHEMA_VERSION,
      run.startedAtEpoch,
      run.operator,
      run.mode,
      run.status,
      run.dbBackend,
      run.sourceFilter,
      run.limit,
      run.companyLimit,
      run.maxUpdates,
      run.batchSize,
      JSON.stringify(run.retryPolicy),
      JSON.stringify(summary || {})
    ]
  );
}

async function updateSqliteRun(db, runId, fields = {}) {
  await db.run(
    `
      UPDATE detail_refetch_runs
      SET status = coalesce(?, status),
          completed_at_epoch = coalesce(?, completed_at_epoch),
          checkpoint_url = coalesce(?, checkpoint_url),
          http_status_counts = coalesce(?, http_status_counts),
          parser_success_count = coalesce(?, parser_success_count),
          parser_failure_count = coalesce(?, parser_failure_count),
          error = coalesce(?, error)
      WHERE run_id = ?
    `,
    [
      fields.status ?? null,
      fields.completedAtEpoch ?? null,
      fields.checkpointUrl ?? null,
      fields.httpStatusCounts ? JSON.stringify(fields.httpStatusCounts) : null,
      fields.parserSuccessCount ?? null,
      fields.parserFailureCount ?? null,
      fields.error ?? null,
      runId
    ]
  );
}

async function updatePostgresRun(pool, runId, fields = {}) {
  await pool.query(
    `
      UPDATE detail_refetch_runs
      SET status = coalesce($1, status),
          completed_at_epoch = coalesce($2, completed_at_epoch),
          checkpoint_url = coalesce($3, checkpoint_url),
          http_status_counts = coalesce($4::jsonb, http_status_counts),
          parser_success_count = coalesce($5, parser_success_count),
          parser_failure_count = coalesce($6, parser_failure_count),
          error = coalesce($7, error)
      WHERE run_id = $8
    `,
    [
      fields.status ?? null,
      fields.completedAtEpoch ?? null,
      fields.checkpointUrl ?? null,
      fields.httpStatusCounts ? JSON.stringify(fields.httpStatusCounts) : null,
      fields.parserSuccessCount ?? null,
      fields.parserFailureCount ?? null,
      fields.error ?? null,
      runId
    ]
  );
}

async function getSqlitePreviouslyFailedUrls(db) {
  try {
    const rows = await db.all(
      `
        SELECT DISTINCT canonical_url
        FROM detail_refetch_changes
        WHERE coalesce(applied, 0) = 0
          AND coalesce(canonical_url, '') <> ''
          AND (coalesce(parser_status, '') = 'failure' OR coalesce(parser_failure_reason, '') <> '')
      `
    );
    return new Set((rows || []).map((row) => clean(row.canonical_url)).filter(Boolean));
  } catch {
    return new Set();
  }
}

async function getPostgresPreviouslyFailedUrls(pool) {
  try {
    const result = await pool.query(
      `
        SELECT DISTINCT canonical_url
        FROM detail_refetch_changes
        WHERE applied = false
          AND coalesce(canonical_url, '') <> ''
          AND (coalesce(parser_status, '') = 'failure' OR coalesce(parser_failure_reason, '') <> '')
      `
    );
    return new Set((result.rows || []).map((row) => clean(row.canonical_url)).filter(Boolean));
  } catch {
    return new Set();
  }
}

function parseAuditValue(value, field) {
  if (field === "quality_flags") return JSON.stringify(parseQualityFlags(value));
  if (field === "quality_score" || field === "posted_at_epoch") return String(Number(value || 0) || 0);
  return clean(value);
}

async function insertSqliteChange(db, runId, row, fetched, plan, item, applied) {
  await db.run(
    `
      INSERT INTO detail_refetch_changes (
        run_id, changed_at_epoch, row_identifier, source_ats, source_company, canonical_url,
        detail_url, http_status, field_name, old_value, new_value, rule_name, confidence,
        source_evidence_summary, reversible_metadata, parser_status, parser_failure_reason, applied
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      runId,
      Math.floor(Date.now() / 1000),
      clean(row.row_id || row.canonical_url),
      norm(row.ats_key),
      clean(row.company_name),
      canonicalUrlForRow(row),
      clean(fetched.detailUrl),
      Number(fetched.status || 0),
      clean(item?.field),
      parseAuditValue(item?.before, item?.field),
      parseAuditValue(item?.after, item?.field),
      clean(item?.rule),
      Number(item?.confidence || 0),
      clean(item?.evidence).slice(0, 500),
      JSON.stringify({ old_value: item?.before, new_value: item?.after }),
      clean(plan?.parser_status),
      clean(plan?.parser_failure_reason),
      applied ? 1 : 0
    ]
  );
}

async function insertPostgresChange(client, runId, row, fetched, plan, item, applied) {
  await client.query(
    `
      INSERT INTO detail_refetch_changes (
        run_id, changed_at_epoch, row_identifier, source_ats, source_company, canonical_url,
        detail_url, http_status, field_name, old_value, new_value, rule_name, confidence,
        source_evidence_summary, reversible_metadata, parser_status, parser_failure_reason, applied
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, $17, $18)
    `,
    [
      runId,
      Math.floor(Date.now() / 1000),
      clean(row.row_id || row.canonical_url),
      norm(row.ats_key),
      clean(row.company_name),
      canonicalUrlForRow(row),
      clean(fetched.detailUrl),
      Number(fetched.status || 0),
      clean(item?.field),
      parseAuditValue(item?.before, item?.field),
      parseAuditValue(item?.after, item?.field),
      clean(item?.rule),
      Number(item?.confidence || 0),
      clean(item?.evidence).slice(0, 500),
      JSON.stringify({ old_value: item?.before, new_value: item?.after }),
      clean(plan?.parser_status),
      clean(plan?.parser_failure_reason),
      Boolean(applied)
    ]
  );
}

function changesToObject(row, changes) {
  const next = { ...row };
  for (const item of changes || []) next[item.field] = item.after;
  return next;
}

function toSearchPayload(row) {
  return {
    canonical_url: canonicalUrlForRow(row),
    company_name: row.company_name,
    position_name: row.position_name,
    apply_url: row.apply_url || canonicalUrlForRow(row),
    location_text: row.location_text || "",
    city: row.city || "",
    country: row.country || "",
    region: row.region || "",
    remote_type: row.remote_type || "unknown",
    industry: row.industry || "",
    ats_key: row.ats_key,
    source_job_id: row.source_job_id || "",
    posting_date: row.posting_date || null,
    posted_at_epoch: row.posted_at_epoch || null,
    last_seen_epoch: row.last_seen_epoch || null,
    hidden: Boolean(row.hidden)
  };
}

async function applyPostgresPlan(client, row, fetched, plan, runId) {
  if (!canApplyDetailPlan(plan)) return { applied: false, changes: 0 };
  const next = changesToObject(row, plan.changes);
  const fieldExpressions = [];
  const values = [canonicalUrlForRow(row)];
  for (const item of plan.changes) {
    if (!WRITABLE_FIELDS.includes(item.field)) continue;
    values.push(item.field === "quality_flags" ? JSON.stringify(parseQualityFlags(item.after)) : item.after);
    if (item.field === "quality_flags") fieldExpressions.push(`${item.field} = $${values.length}::jsonb`);
    else if (item.field === "quality_score" || item.field === "posted_at_epoch") fieldExpressions.push(`${item.field} = $${values.length}::bigint`);
    else fieldExpressions.push(`${item.field} = NULLIF($${values.length}, '')`);
  }
  if (fieldExpressions.length === 0) return { applied: false, changes: 0 };
  await client.query(
    `UPDATE postings SET ${fieldExpressions.join(", ")}, updated_at = now() WHERE canonical_url = $1;`,
    values
  );
  await client.query(
    `UPDATE posting_cache SET ${fieldExpressions.join(", ")}, updated_at = now() WHERE canonical_url = $1;`,
    values
  );

  const canonicalUrl = canonicalUrlForRow(row);
  const updatedRowResult = await client.query("SELECT * FROM postings WHERE canonical_url = $1;", [canonicalUrl]);
  let finalRow = next;
  let finalStatus = "quarantined";
  let reasonCodes = [];
  let rejectionReason = "";
  if (updatedRowResult.rows.length > 0) {
    const updatedRow = updatedRowResult.rows[0];
    const { evaluatePublicPosting, validationFromGate } = require("../publicPostingGate");
    const gate = evaluatePublicPosting(updatedRow, { parserVersion: updatedRow.parser_version });
    const validation = validationFromGate(gate);
    finalStatus = validation.status;
    reasonCodes = gate.reason_codes || [];
    rejectionReason = validation.error || "";

    await client.query(
      "UPDATE posting_cache SET validation_status = $1, validation_error = $2, updated_at = now() WHERE canonical_url = $3;",
      [validation.status, rejectionReason, canonicalUrl]
    );

    const nextHidden = validation.status !== "valid";
    await client.query(
      "UPDATE postings SET hidden = $1, rejection_reason = $2, updated_at = now() WHERE canonical_url = $3;",
      [nextHidden, rejectionReason, canonicalUrl]
    );
    finalRow = { ...updatedRow, hidden: nextHidden };
  }

  if (finalStatus === "valid") {
    await client.query(
      "INSERT INTO search_index_outbox (canonical_url, operation, payload, available_at) VALUES ($1, 'upsert', $2::jsonb, now());",
      [canonicalUrl, JSON.stringify(toSearchPayload(finalRow))]
    );
  } else {
    await client.query(
      "INSERT INTO search_index_outbox (canonical_url, operation, payload, available_at) VALUES ($1, 'delete', $2::jsonb, now());",
      [
        canonicalUrl,
        JSON.stringify({
          reason: finalStatus,
          canonical_url: canonicalUrl,
          reason_codes: reasonCodes
        })
      ]
    );
  }

  for (const item of plan.changes) {
    await insertPostgresChange(client, runId, row, fetched, plan, item, true);
  }
  return { applied: true, changes: plan.changes.length };
}

async function applySqlitePlan(db, row, fetched, plan, runId) {
  if (!canApplyDetailPlan(plan)) return { applied: false, changes: 0 };
  const assignments = [];
  const values = [];
  for (const item of plan.changes) {
    assignments.push(`${item.field} = ?`);
    values.push(item.field === "quality_flags" ? JSON.stringify(parseQualityFlags(item.after)) : item.after);
  }
  if (assignments.length === 0) return { applied: false, changes: 0 };
  values.push(canonicalUrlForRow(row));
  await db.run(`UPDATE Postings SET ${assignments.join(", ")} WHERE job_posting_url = ?;`, values);

  const canonicalUrl = canonicalUrlForRow(row);
  const nextRows = await db.all("SELECT * FROM Postings WHERE job_posting_url = ?;", [canonicalUrl]);
  const nextRow = nextRows[0] || null;
  if (nextRow) {
    const mappedRow = {
      ...nextRow,
      position_name: nextRow.position_name || nextRow.title,
      canonical_url: nextRow.job_posting_url || nextRow.canonical_url,
      hidden: Boolean(nextRow.hidden)
    };
    const { evaluatePublicPosting, validationFromGate } = require("../publicPostingGate");
    const gate = evaluatePublicPosting(mappedRow, { parserVersion: mappedRow.parser_version });
    const validation = validationFromGate(gate);
    
    try {
      await db.run(
        "UPDATE posting_cache SET validation_status = ?, validation_error = ?, updated_at = datetime('now') WHERE canonical_url = ?;",
        [validation.status, validation.error || "", canonicalUrl]
      );
    } catch (e) {}

    const nextHidden = validation.status !== "valid" ? 1 : 0;
    await db.run(
      "UPDATE Postings SET hidden = ? WHERE job_posting_url = ?;",
      [nextHidden, canonicalUrl]
    );
  }

  for (const item of plan.changes) {
    await insertSqliteChange(db, runId, row, fetched, plan, item, true);
  }
  return { applied: true, changes: plan.changes.length };
}

function incrementStatus(counts, status) {
  const key = String(status || 0);
  counts[key] = (counts[key] || 0) + 1;
}

async function runDetailRefetchWithDb(dbHandle, dbBackend, options = {}, env = {}) {
  const safety = getSafetyGate(options);
  const applyMode = safety.authorized;
  const runId = clean(options.resumeRunId) || createRunId();
  const startedAtEpoch = Math.floor(Date.now() / 1000);
  const loadRows = dbBackend === "postgres"
    ? await loadPostgresCandidates(dbHandle, options)
    : await loadSqliteCandidates(dbHandle, options);
  const previouslyFailedUrls = dbBackend === "postgres"
    ? await getPostgresPreviouslyFailedUrls(dbHandle)
    : await getSqlitePreviouslyFailedUrls(dbHandle);
  const eligibleCandidates = loadRows.filter((row) => isCandidateRow(row).ok);
  const candidates = eligibleCandidates.filter((row) => !previouslyFailedUrls.has(canonicalUrlForRow(row)));
  const candidateSummary = summarizeCandidates(candidates, options);
  const run = {
    runId,
    startedAtEpoch,
    operator: clean(options.operator || env.USERNAME || env.USER || "codex"),
    mode: applyMode ? "apply" : "dry-run",
    status: "running",
    dbBackend,
    sourceFilter: (options.sources || []).join(","),
    limit: options.limit || DEFAULT_LIMIT,
    companyLimit: options.companyLimit || DEFAULT_COMPANY_LIMIT,
    maxUpdates: options.maxUpdates || 0,
    batchSize: options.batchSize || DEFAULT_BATCH_SIZE,
    retryPolicy: {
      delay_ms: options.delayMs || DEFAULT_DELAY_MS,
      jitter_ms: options.jitterMs || DEFAULT_JITTER_MS,
      timeout_ms: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      concurrency: 1
    }
  };

  if (applyMode) {
    if (dbBackend === "postgres") await insertPostgresRun(dbHandle, run, candidateSummary);
    else await insertSqliteRun(dbHandle, run, candidateSummary);
  }

  const report = {
    ok: true,
    dry_run: !applyMode,
    apply_mode: applyMode,
    run_id: runId,
    safety_gate: safety,
    sources: options.sources || ["icims", "applitrack"],
    total_candidates: candidates.length,
    skipped_previously_failed: eligibleCandidates.length - candidates.length,
    candidate_summary: candidateSummary,
    fetched: 0,
    parser_success_count: 0,
    parser_failure_count: 0,
    planned_rows: 0,
    planned_changes: 0,
    applied_rows: 0,
    applied_changes: 0,
    http_status_counts: {},
    errors: [],
    samples: []
  };

  let batchCount = 0;
  let client = null;
  try {
    if (applyMode && dbBackend === "postgres") {
      client = await dbHandle.connect();
      await client.query("BEGIN");
    } else if (applyMode && dbBackend === "sqlite") {
      await dbHandle.exec("BEGIN");
    }

    for (const row of candidates) {
      if (applyMode && report.applied_rows >= Number(options.maxUpdates || 0)) break;
      const fetched = await fetchDetailHtml(row, options);
      incrementStatus(report.http_status_counts, fetched.status);
      if (!fetched.ok) {
        report.parser_failure_count += 1;
        report.errors.push({
          source_ats: norm(row.ats_key),
          canonical_url: canonicalUrlForRow(row),
          detail_url: fetched.detailUrl,
          error: fetched.error,
          http_status: fetched.status,
          backoff_ms: fetched.backoff_ms
        });
        if (applyMode) {
          const failurePlan = { parser_status: "failure", parser_failure_reason: fetched.error, changes: [] };
          const item = change("", "", "", "detail_fetch_failure", 0, fetched.error);
          if (dbBackend === "postgres") await insertPostgresChange(client, runId, row, fetched, failurePlan, item, false);
          else await insertSqliteChange(dbHandle, runId, row, fetched, failurePlan, item, false);
        }
        await politeDelay(options);
        continue;
      }
      report.fetched += 1;
      const detail = extractDetailFields(row, fetched.html);
      const plan = planDetailChanges(row, detail);
      if (plan.changes.length > 0) {
        report.parser_success_count += 1;
        report.planned_rows += 1;
        report.planned_changes += plan.changes.length;
        if (report.samples.length < Number(options.sample || 0)) {
          report.samples.push({
            source_ats: norm(row.ats_key),
            canonical_url: canonicalUrlForRow(row),
            detail_url: fetched.detailUrl,
            before: {
              location_text: row.location_text || "",
              country: row.country || "",
              region: row.region || "",
              city: row.city || "",
              remote_type: row.remote_type || "unknown",
              source_job_id: row.source_job_id || "",
              posting_date: row.posting_date || null
            },
            proposed_changes: plan.changes.map((item) => ({
              field: item.field,
              before: item.before,
              after: item.after,
              rule: item.rule,
              confidence: item.confidence
            }))
          });
        }
        if (applyMode) {
          const applied = dbBackend === "postgres"
            ? await applyPostgresPlan(client, row, fetched, plan, runId)
            : await applySqlitePlan(dbHandle, row, fetched, plan, runId);
          if (applied.applied) {
            report.applied_rows += 1;
            report.applied_changes += applied.changes;
            batchCount += 1;
          }
          if (batchCount >= Number(options.batchSize || DEFAULT_BATCH_SIZE)) {
            if (dbBackend === "postgres") {
              await client.query("COMMIT");
              await client.query("BEGIN");
            } else {
              await dbHandle.exec("COMMIT");
              await dbHandle.exec("BEGIN");
            }
            batchCount = 0;
          }
        }
      } else {
        report.parser_failure_count += 1;
      }
      report.checkpoint_url = canonicalUrlForRow(row);
      await politeDelay(options);
    }

    if (applyMode) {
      if (dbBackend === "postgres") await client.query("COMMIT");
      else await dbHandle.exec("COMMIT");
    }
  } catch (error) {
    report.ok = false;
    report.errors.push({ error: clean(error?.message || error) });
    if (applyMode) {
      if (dbBackend === "postgres" && client) await client.query("ROLLBACK");
      if (dbBackend === "sqlite") await dbHandle.exec("ROLLBACK");
    }
    if (!options.continueOnError) throw error;
  } finally {
    if (client) client.release();
  }

  if (applyMode) {
    const fields = {
      status: report.ok ? "completed" : "failed",
      completedAtEpoch: Math.floor(Date.now() / 1000),
      checkpointUrl: report.checkpoint_url || "",
      httpStatusCounts: report.http_status_counts,
      parserSuccessCount: report.parser_success_count,
      parserFailureCount: report.parser_failure_count,
      error: report.ok ? "" : clean(report.errors[report.errors.length - 1]?.error)
    };
    if (dbBackend === "postgres") await updatePostgresRun(dbHandle, runId, fields);
    else await updateSqliteRun(dbHandle, runId, fields);
  }

  return report;
}

async function runDetailRefetch(options = {}, env = process.env) {
  const dbBackend = norm(env.OPENJOBSLOTS_DB_BACKEND || "sqlite") === "postgres" ? "postgres" : "sqlite";
  if (dbBackend === "postgres") {
    const pool = options.pool || createPostgresPool({
      enabled: true,
      connectionString: env.DATABASE_URL || env.POSTGRES_URL || ""
    });
    let heavyJobLock = null;
    try {
      const safetyGate = getSafetyGate(options);
      if (!options.pool) {
        heavyJobLock = await acquireHeavyJobLock(
          pool,
          safetyGate.authorized ? "detail-refetch" : "detail-refetch-dry-run"
        );
      }
      if (safetyGate.authorized) {
        await ensurePostgresDetailRefetchSchema(pool);
      }
      const report = await runDetailRefetchWithDb(pool, "postgres", options, env);
      if (heavyJobLock) await heavyJobLock.release("succeeded");
      heavyJobLock = null;
      return report;
    } catch (error) {
      if (heavyJobLock) await heavyJobLock.release("failed");
      heavyJobLock = null;
      throw error;
    } finally {
      if (!options.pool) await pool.end();
    }
  }

  const dbPath = env.DB_PATH || env.SQLITE_DB_PATH || path.join(process.cwd(), "data", "jobs.db");
  const write = getSafetyGate(options).authorized;
  const db = write ? await openSqliteWritable(dbPath) : await openSqliteReadOnly(dbPath);
  try {
    if (write) await ensureSqliteDetailRefetchSchema(db);
    return await runDetailRefetchWithDb(db, "sqlite", options, env);
  } finally {
    await db.close();
  }
}

module.exports = {
  DETAIL_REFETCH_SCHEMA_VERSION,
  SUPPORTED_SOURCES,
  WRITABLE_FIELDS,
  applitrackSiteRootFromUrl,
  buildNormalizedFromDetail,
  canApplyDetailPlan,
  capRowsByCompany,
  detailUrlForRow,
  ensurePostgresDetailRefetchSchema,
  ensureSqliteDetailRefetchSchema,
  extractDetailFields,
  extractSourceJobIdFromUrl,
  fetchDetailHtml,
  getSafetyGate,
  isAllowedDetailUrl,
  isCandidateRow,
  loadPostgresCandidates,
  loadSqliteCandidates,
  parseArgs,
  planDetailChanges,
  politeDelay,
  runDetailRefetch,
  runDetailRefetchWithDb,
  summarizeCandidates,
  toSearchPayload
};
