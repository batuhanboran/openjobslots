const { createPostgresPool } = require("../server/backends/postgres");
const { getPostgresPublicSearchReport } = require("../server/backends/postgresStore");
const { formatReport } = require("./report-public-analytics");

const DEFAULT_REPORT_TO = "maintainer@example.com";

function parseBoolean(value, fallback = false) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    date: String(env.OPENJOBSLOTS_ANALYTICS_DATE || "today").trim() || "today",
    timezone: String(env.OPENJOBSLOTS_ANALYTICS_TIMEZONE || "Europe/Istanbul").trim() || "Europe/Istanbul",
    limit: 15,
    dryRun: parseBoolean(env.OPENJOBSLOTS_ANALYTICS_EMAIL_DRY_RUN, false),
    sample: false
  };

  for (const arg of argv) {
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--sample") options.sample = true;
    else if (arg.startsWith("--date=")) options.date = String(arg.slice("--date=".length) || "").trim();
    else if (arg === "--date") options.expectDate = true;
    else if (arg.startsWith("--timezone=")) options.timezone = String(arg.slice("--timezone=".length) || "").trim();
    else if (arg === "--timezone") options.expectTimezone = true;
    else if (arg.startsWith("--limit=")) options.limit = Number(arg.slice("--limit=".length));
    else if (arg === "--limit") options.expectLimit = true;
    else if (options.expectDate) {
      options.date = String(arg || "").trim();
      options.expectDate = false;
    } else if (options.expectTimezone) {
      options.timezone = String(arg || "").trim();
      options.expectTimezone = false;
    } else if (options.expectLimit) {
      options.limit = Number(arg);
      options.expectLimit = false;
    }
  }

  options.limit = Math.max(1, Math.min(50, Math.floor(Number(options.limit || 15))));
  return options;
}

function normalizeEmail(value) {
  const email = String(value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function formatCount(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString("en-US") : "0";
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  if (unitIndex === 0) return `${Math.round(size).toLocaleString("en-US")} ${units[unitIndex]}`;
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function formatPercent(value) {
  if (!Number.isFinite(Number(value))) return "n/a";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function formatQueryList(items = [], key = "query") {
  if (!Array.isArray(items) || items.length === 0) return "none";
  return items.map((item) => `${item[key]} (${formatCount(item.count)})`).join(", ");
}

function formatNamedCounts(items = [], key = "name") {
  if (!Array.isArray(items) || items.length === 0) return "none";
  return items.map((item) => `${item[key]}=${formatCount(item.count)}`).join(", ");
}

function formatRemoteIntent(counts = {}) {
  return ["remote", "hybrid", "non_remote", "all", "unknown"]
    .map((key) => `${key}=${formatCount(counts[key] || 0)}`)
    .join(", ");
}

function formatResultBuckets(counts = {}) {
  return [
    `zero=${formatCount(counts.zero_result || 0)}`,
    `low=${formatCount(counts.low_result || 0)}`,
    `normal=${formatCount(counts.normal_result || 0)}`,
    `unknown=${formatCount(counts.unknown_result || 0)}`
  ].join(", ");
}

function calculateZeroResultRate(report = {}) {
  const counts = report.result_count_distribution || {};
  const knownResultCount =
    Number(counts.zero_result || 0) +
    Number(counts.low_result || 0) +
    Number(counts.normal_result || 0);
  if (knownResultCount > 0) {
    return Number(counts.zero_result || 0) / knownResultCount;
  }
  return Number(report.total_events || 0) > 0
    ? Number(counts.zero_result || 0) / Number(report.total_events || 0)
    : null;
}

function formatDateInTimezone(now, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now instanceof Date ? now : new Date(now));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDaysToIsoDate(value, days) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Number(days || 0)));
  return date.toISOString().slice(0, 10);
}

function resolveReportDate(value, timezone, now = new Date()) {
  const raw = String(value || "").trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const today = formatDateInTimezone(now, timezone || "Europe/Istanbul");
  return raw === "yesterday" ? addDaysToIsoDate(today, -1) : today;
}

function readEmailConfig(env = process.env) {
  const port = Math.max(1, Math.min(65535, Number(env.OPENJOBSLOTS_SMTP_PORT || env.SMTP_PORT || 465)));
  const secure = parseBoolean(env.OPENJOBSLOTS_SMTP_SECURE || env.SMTP_SECURE, port === 465);

  return {
    to: normalizeEmail(env.OPENJOBSLOTS_ANALYTICS_EMAIL_TO || DEFAULT_REPORT_TO),
    from: normalizeEmail(env.OPENJOBSLOTS_ANALYTICS_EMAIL_FROM || env.SMTP_FROM || ""),
    smtp: {
      host: String(env.OPENJOBSLOTS_SMTP_HOST || env.SMTP_HOST || "").trim(),
      port,
      secure,
      user: String(env.OPENJOBSLOTS_SMTP_USER || env.SMTP_USER || "").trim(),
      pass: String(env.OPENJOBSLOTS_SMTP_PASS || env.SMTP_PASS || "")
    }
  };
}

function readCloudflareConfig(env = process.env) {
  return {
    token: String(env.OPENJOBSLOTS_CLOUDFLARE_API_TOKEN || env.CLOUDFLARE_API_TOKEN || "").trim(),
    zoneId: String(env.OPENJOBSLOTS_CLOUDFLARE_ZONE_ID || env.CLOUDFLARE_ZONE_ID || "").trim(),
    zoneName: String(env.OPENJOBSLOTS_CLOUDFLARE_ZONE_NAME || "openjobslots.com").trim()
  };
}

function getReportDateUtcRange(date, timezone, now = new Date()) {
  const rawDate = resolveReportDate(date, timezone, now);
  const match = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return { since: -1440, until: 0 };
  if (String(timezone || "Europe/Istanbul") !== "Europe/Istanbul") {
    return {
      since: `${rawDate}T00:00:00.000Z`,
      until: `${rawDate}T23:59:59.999Z`
    };
  }
  const start = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) - 1, 21, 0, 0, 0));
  const end = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 20, 59, 59, 999));
  const today = formatDateInTimezone(now, timezone || "Europe/Istanbul");
  return {
    since: start.toISOString(),
    until: rawDate === today ? 0 : end.toISOString()
  };
}

function toCloudflareTime(value, now = new Date()) {
  if (Number.isFinite(Number(value))) {
    return new Date((now instanceof Date ? now : new Date()).getTime() + Number(value) * 60 * 1000).toISOString();
  }
  return String(value || "").trim();
}

function mapCloudflareGroups(rows = [], dimensionKey, outputKey, fallback = "unknown") {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({
      [outputKey]: String(row?.dimensions?.[dimensionKey] ?? fallback).trim() || fallback,
      count: Number(row?.count || 0)
    }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || String(a[outputKey]).localeCompare(String(b[outputKey])));
}

function mapCloudflareStatusCodes(rows = []) {
  return Object.fromEntries(
    mapCloudflareGroups(rows, "edgeResponseStatus", "status", "unknown")
      .map((item) => [String(item.status), item.count])
  );
}

async function fetchCloudflareTrafficSummary(report, config = readCloudflareConfig(), fetchImpl = globalThis.fetch) {
  if (!config.token || !config.zoneId) {
    return {
      ok: false,
      unavailable_reason: "OPENJOBSLOTS_CLOUDFLARE_API_TOKEN and OPENJOBSLOTS_CLOUDFLARE_ZONE_ID are not configured"
    };
  }
  if (typeof fetchImpl !== "function") {
    return { ok: false, unavailable_reason: "fetch API is unavailable in this Node runtime" };
  }

  const range = getReportDateUtcRange(report.date, report.timezone, report.now);
  const now = report.now instanceof Date ? report.now : new Date();
  const variables = {
    zoneTag: config.zoneId,
    since: toCloudflareTime(range.since, now),
    until: toCloudflareTime(range.until === 0 ? now.toISOString() : range.until, now)
  };
  const query = `
    query OpenJobSlotsDailyTraffic($zoneTag: string, $since: Time, $until: Time) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          totals: httpRequestsAdaptiveGroups(limit: 1, filter: { datetime_geq: $since, datetime_lt: $until }) {
            count
            sum { visits edgeResponseBytes }
            ratio { status4xx status5xx }
          }
          countries: httpRequestsAdaptiveGroups(limit: 10, filter: { datetime_geq: $since, datetime_lt: $until }, orderBy: [count_DESC]) {
            count
            dimensions { clientCountryName }
          }
          statuses: httpRequestsAdaptiveGroups(limit: 10, filter: { datetime_geq: $since, datetime_lt: $until }, orderBy: [count_DESC]) {
            count
            dimensions { edgeResponseStatus }
          }
          cache: httpRequestsAdaptiveGroups(limit: 10, filter: { datetime_geq: $since, datetime_lt: $until }, orderBy: [count_DESC]) {
            count
            dimensions { cacheStatus }
          }
          paths: httpRequestsAdaptiveGroups(limit: 10, filter: { datetime_geq: $since, datetime_lt: $until }, orderBy: [count_DESC]) {
            count
            dimensions { clientRequestPath }
          }
          devices: httpRequestsAdaptiveGroups(limit: 10, filter: { datetime_geq: $since, datetime_lt: $until }, orderBy: [count_DESC]) {
            count
            dimensions { clientDeviceType }
          }
          browsers: httpRequestsAdaptiveGroups(limit: 10, filter: { datetime_geq: $since, datetime_lt: $until }, orderBy: [count_DESC]) {
            count
            dimensions { userAgentBrowser }
          }
        }
      }
    }
  `;

  try {
    const response = await fetchImpl("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query, variables })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || (Array.isArray(payload?.errors) && payload.errors.length > 0)) {
      const firstError = payload?.errors?.[0];
      const message = firstError?.message || response.statusText || "request failed";
      return {
        ok: false,
        status: response.status,
        unavailable_reason: `Cloudflare analytics unavailable (${response.status} ${message})`
      };
    }

    const zone = payload?.data?.viewer?.zones?.[0];
    const totals = zone?.totals?.[0] || {};
    const visits = Number(totals?.sum?.visits || 0);
    return {
      ok: true,
      source: "cloudflare_graphql_http_requests_adaptive",
      zone_name: config.zoneName,
      visits,
      visitors: visits,
      requests: Number(totals?.count || 0),
      bandwidth_bytes: Number(totals?.sum?.edgeResponseBytes || 0),
      status4xx_ratio: Number(totals?.ratio?.status4xx || 0),
      status5xx_ratio: Number(totals?.ratio?.status5xx || 0),
      top_countries: mapCloudflareGroups(zone?.countries, "clientCountryName", "code"),
      status_codes: mapCloudflareStatusCodes(zone?.statuses),
      cache_statuses: mapCloudflareGroups(zone?.cache, "cacheStatus", "status"),
      top_paths: mapCloudflareGroups(zone?.paths, "clientRequestPath", "path"),
      device_types: mapCloudflareGroups(zone?.devices, "clientDeviceType", "type"),
      browsers: mapCloudflareGroups(zone?.browsers, "userAgentBrowser", "name"),
      since: range.since,
      until: range.until
    };
  } catch (error) {
    return {
      ok: false,
      unavailable_reason: `Cloudflare analytics unavailable (${String(error?.message || error)})`
    };
  }
}

function validateEmailConfig(config) {
  const missing = [];
  if (!config.to) missing.push("OPENJOBSLOTS_ANALYTICS_EMAIL_TO");
  if (!config.from) missing.push("OPENJOBSLOTS_ANALYTICS_EMAIL_FROM");
  if (!config.smtp.host) missing.push("OPENJOBSLOTS_SMTP_HOST");
  if (!config.smtp.user) missing.push("OPENJOBSLOTS_SMTP_USER");
  if (!config.smtp.pass) missing.push("OPENJOBSLOTS_SMTP_PASS");
  return missing;
}

function createSampleAnalyticsReport(options = {}) {
  const timezone = String(options.timezone || "Europe/Istanbul");
  return {
    ok: true,
    read_only: true,
    sample: true,
    date: resolveReportDate(options.date || "today", timezone, options.now),
    timezone,
    total_events: 1284,
    anonymous_session_count: 327,
    event_counts: { postings: 836, suggest: 318, filter_options: 130 },
    top_endpoint: { endpoint: "/postings", event_type: "postings", count: 836 },
    top_terms: [
      { query: "software engineer", count: 112 },
      { query: "remote data analyst", count: 74 },
      { query: "warehouse associate", count: 51 }
    ],
    top_normalized_queries: [
      { query: "software engineer", count: 112 },
      { query: "remote data analyst", count: 74 }
    ],
    top_final_posting_searches: [
      { query: "software engineer", count: 88 },
      { query: "remote data analyst", count: 59 }
    ],
    top_job_title_keywords: [
      { query: "software engineer", count: 88 },
      { query: "remote data analyst", count: 59 }
    ],
    top_country_filters: [
      { value: "United States", count: 96 },
      { value: "Turkey", count: 42 },
      { value: "Germany", count: 28 }
    ],
    remote_filter_counts: {
      all: 835,
      remote: 312,
      hybrid: 96,
      non_remote: 41,
      unknown: 0
    },
    top_suggest_inputs: [
      { query: "software", count: 61 },
      { query: "remote", count: 47 }
    ],
    result_count_distribution: {
      zero_result: 42,
      low_result: 116,
      normal_result: 1097,
      unknown_result: 29
    },
    top_zero_result_queries: [
      { query: "wordpress developer", count: 18 },
      { query: "visa sponsorship nurse", count: 11 }
    ],
    top_low_result_queries: [
      { query: "teacher", count: 27 },
      { query: "cybersecurity intern", count: 19 }
    ],
    cache_status_counts: { HIT: 1041, MISS: 243 },
    cache_hit_rate: 1041 / 1284,
    top_referrers: [
      { host: "www.google.com", count: 214 },
      { host: "openjobslots.com", count: 93 },
      { host: "www.bing.com", count: 21 }
    ],
    top_user_agent_families: [
      { family: "Chrome", count: 801 },
      { family: "Safari", count: 276 },
      { family: "Firefox", count: 93 }
    ],
    cloudflare_traffic: {
      ok: true,
      source: "cloudflare_graphql_http_requests_adaptive",
      visits: 487,
      visitors: 487,
      requests: 1432,
      bandwidth_bytes: 184392114,
      status4xx_ratio: 0.031,
      status5xx_ratio: 0,
      top_countries: [
        { code: "US", count: 612 },
        { code: "TR", count: 338 },
        { code: "DE", count: 121 }
      ],
      status_codes: { "200": 1208, "301": 118, "404": 19, "403": 3 },
      cache_statuses: [
        { status: "dynamic", count: 910 },
        { status: "none", count: 321 },
        { status: "miss", count: 143 }
      ],
      top_paths: [
        { path: "/", count: 612 },
        { path: "/postings", count: 338 },
        { path: "/search/suggest", count: 207 }
      ],
      device_types: [
        { type: "desktop", count: 992 },
        { type: "mobile", count: 438 },
        { type: "tablet", count: 2 }
      ],
      browsers: [
        { name: "Chrome", count: 602 },
        { name: "Firefox", count: 356 },
        { name: "MobileSafari", count: 203 }
      ]
    }
  };
}

function formatCloudflareTrafficText(traffic = {}) {
  if (!traffic || traffic.ok !== true) {
    const reason = traffic?.unavailable_reason || "not configured";
    return `Cloudflare: unavailable (${reason})`;
  }
  return [
    `Cloudflare: visits=${formatCount(traffic.visits ?? traffic.visitors)}, requests=${formatCount(traffic.requests)}, bandwidth=${formatBytes(traffic.bandwidth_bytes)}`,
    `Edge countries: ${formatQueryList(traffic.top_countries || [], "code")}`,
    `Top edge paths: ${formatQueryList(traffic.top_paths || [], "path")}`,
    `Edge cache: ${formatNamedCounts(traffic.cache_statuses || [], "status")}`,
    `Status codes: ${Object.entries(traffic.status_codes || {}).map(([code, count]) => `${code}=${formatCount(count)}`).join(", ") || "none"}`,
    `Edge error ratios: 4xx=${formatPercent(traffic.status4xx_ratio)}, 5xx=${formatPercent(traffic.status5xx_ratio)}`,
    `Devices: ${formatNamedCounts(traffic.device_types || [], "type")}`,
    `Browsers: ${formatNamedCounts(traffic.browsers || [], "name")}`
  ].join("\n");
}

function buildAnalyticsEmailText(report) {
  const resultCounts = report.result_count_distribution || {};
  const zeroRate = calculateZeroResultRate(report);
  const topFinalSearches = report.top_final_posting_searches || [];
  const topDisplayedQueries = topFinalSearches.length > 0
    ? topFinalSearches
    : (report.top_normalized_queries || report.top_terms || []);

  return [
    `OpenJobSlots analytics:daily - ${report.date} (${report.timezone})`,
    "",
    "Executive snapshot",
    `- Backend events: ${formatCount(report.total_events)} from ${formatCount(report.anonymous_session_count)} anonymous sessions`,
    `- Zero-result rate: ${formatPercent(zeroRate)} (${formatCount(resultCounts.zero_result || 0)} zero-result searches)`,
    `- Cache hit rate: ${formatPercent(report.cache_hit_rate)}`,
    "",
    "Demand snapshot",
    `- Top queries: ${formatQueryList(topDisplayedQueries)}`,
    `- Top final searches: ${formatQueryList(report.top_final_posting_searches)}`,
    `- Top countries: ${formatQueryList(report.top_country_filters || [], "value")}`,
    `- Remote intent: ${formatRemoteIntent(report.remote_filter_counts || {})}`,
    `- Result buckets: ${formatResultBuckets(resultCounts)}`,
    "",
    "Search gaps",
    `- Zero-result queries: ${formatQueryList(report.top_zero_result_queries)}`,
    `- Low-result queries: ${formatQueryList(report.top_low_result_queries)}`,
    "",
    "Traffic snapshot",
    formatCloudflareTrafficText(report.cloudflare_traffic),
    `Backend referrers: ${formatQueryList(report.top_referrers || [], "host")}`,
    "",
    "Raw backend appendix",
    formatReport(report),
    "",
    "Privacy note: no IPs, raw user agents, full URLs, emails, phone numbers, or applicant data are included."
  ].join("\n");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function metricCard(label, value) {
  return `<td style="padding:12px;border:1px solid #d9e2ec;border-radius:6px;background:#f8fafc"><div style="font-size:12px;color:#52616b;text-transform:uppercase;letter-spacing:.04em">${escapeHtml(label)}</div><div style="font-size:22px;font-weight:700;color:#102a43;margin-top:4px">${escapeHtml(value)}</div></td>`;
}

function listItems(items = [], key = "query") {
  if (!Array.isArray(items) || items.length === 0) return "<li>none</li>";
  return items.map((item) => `<li><strong>${escapeHtml(item[key])}</strong> <span style="color:#52616b">(${formatCount(item.count)})</span></li>`).join("");
}

function buildAnalyticsEmailHtml(report) {
  const resultCounts = report.result_count_distribution || {};
  const zeroRate = calculateZeroResultRate(report);
  const topFinalSearches = report.top_final_posting_searches || [];
  const topDisplayedQueries = topFinalSearches.length > 0
    ? topFinalSearches
    : (report.top_normalized_queries || report.top_terms || []);
  const traffic = report.cloudflare_traffic || {};
  const cloudflareSummary = traffic.ok === true
    ? `${formatCount(traffic.visits ?? traffic.visitors)} visits / ${formatCount(traffic.requests)} requests / ${formatBytes(traffic.bandwidth_bytes)}`
    : `Unavailable: ${traffic.unavailable_reason || "not configured"}`;

  return [
    '<!doctype html>',
    '<html><body style="margin:0;padding:0;background:#eef2f6;font-family:Arial,Helvetica,sans-serif;color:#102a43">',
    '<div style="max-width:760px;margin:0 auto;padding:24px">',
    '<div style="background:#ffffff;border:1px solid #d9e2ec;border-radius:8px;overflow:hidden">',
    '<div style="padding:22px 24px;background:#12355b;color:#ffffff">',
    `<div style="font-size:13px;opacity:.82">OpenJobSlots</div><h1 style="margin:4px 0 0;font-size:24px;line-height:1.2">analytics:daily - ${escapeHtml(report.date)}</h1>`,
    `<div style="margin-top:6px;font-size:13px;opacity:.82">${escapeHtml(report.timezone)}</div>`,
    '</div>',
    '<div style="padding:20px 24px">',
    '<table role="presentation" cellspacing="8" cellpadding="0" style="width:100%;border-collapse:separate;border-spacing:8px;margin:0 -8px 14px">',
    '<tr>',
    metricCard("Backend events", formatCount(report.total_events)),
    metricCard("Anonymous sessions", formatCount(report.anonymous_session_count)),
    metricCard("Zero-result rate", formatPercent(zeroRate)),
    '</tr><tr>',
    metricCard("Cache hit rate", formatPercent(report.cache_hit_rate)),
    metricCard("Cloudflare edge", cloudflareSummary),
    metricCard("Top query", topDisplayedQueries[0]?.query || "none"),
    '</tr>',
    '</table>',
    '<h2>Demand snapshot</h2>',
    '<h3>Top queries</h3><ol>',
    listItems(topDisplayedQueries),
    '</ol>',
    '<h3>Top countries</h3><ol>',
    listItems(report.top_country_filters || [], "value"),
    '</ol>',
    `<p><strong>Remote intent:</strong> ${escapeHtml(formatRemoteIntent(report.remote_filter_counts || {}))}</p>`,
    `<p><strong>Result buckets:</strong> ${escapeHtml(formatResultBuckets(resultCounts))}</p>`,
    '<h2>Search gaps</h2>',
    `<p><strong>Zero-result queries:</strong> ${escapeHtml(formatQueryList(report.top_zero_result_queries))}</p>`,
    `<p><strong>Low-result queries:</strong> ${escapeHtml(formatQueryList(report.top_low_result_queries))}</p>`,
    '<h2>Traffic snapshot</h2>',
    `<p><strong>Cloudflare edge:</strong> ${escapeHtml(cloudflareSummary)}</p>`,
    `<p><strong>Top edge paths:</strong> ${escapeHtml(formatQueryList(traffic.top_paths || [], "path"))}</p>`,
    `<p><strong>Edge cache:</strong> ${escapeHtml(formatNamedCounts(traffic.cache_statuses || [], "status"))}</p>`,
    `<p><strong>Devices:</strong> ${escapeHtml(formatNamedCounts(traffic.device_types || [], "type"))}</p>`,
    `<p><strong>Browsers:</strong> ${escapeHtml(formatNamedCounts(traffic.browsers || [], "name"))}</p>`,
    '<h3>Backend referrers</h3><ol>',
    listItems(report.top_referrers || [], "host"),
    '</ol>',
    '<p style="font-size:12px;color:#52616b">Privacy: no IPs, raw user agents, full URLs, emails, phone numbers, or applicant data are included.</p>',
    '</div></div></div></body></html>'
  ].join("");
}

function buildAnalyticsEmailMessage(report, config) {
  const text = buildAnalyticsEmailText(report);

  return {
    to: config.to,
    from: config.from,
    subject: `OpenJobSlots analytics:daily ${report.date} (${report.timezone})`,
    text,
    html: buildAnalyticsEmailHtml(report)
  };
}

async function sendAnalyticsEmailMessage(message, config, nodemailerModule = null) {
  const nodemailer = nodemailerModule || require("nodemailer");
  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: {
      user: config.smtp.user,
      pass: config.smtp.pass
    }
  });
  return transporter.sendMail(message);
}

async function loadReport(options) {
  if (options.sample) return createSampleAnalyticsReport(options);

  const pool = createPostgresPool({
    enabled: true,
    connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL || ""
  });
  try {
    const report = await getPostgresPublicSearchReport(pool, options);
    report.cloudflare_traffic = await fetchCloudflareTrafficSummary(report);
    return report;
  } finally {
    if (pool && typeof pool.end === "function") await pool.end();
  }
}

async function main() {
  const options = parseArgs();
  const report = await loadReport(options);
  const config = readEmailConfig();
  const message = buildAnalyticsEmailMessage(report, config);

  if (options.dryRun) {
    console.log(message.text);
    return;
  }

  const missing = validateEmailConfig(config);
  if (missing.length > 0) {
    throw new Error(`Missing analytics email configuration: ${missing.join(", ")}`);
  }

  const info = await sendAnalyticsEmailMessage(message, config);
  console.log(JSON.stringify({ ok: true, to: config.to, messageId: info?.messageId || null }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  buildAnalyticsEmailMessage,
  createSampleAnalyticsReport,
  fetchCloudflareTrafficSummary,
  calculateZeroResultRate,
  parseArgs,
  readCloudflareConfig,
  readEmailConfig,
  sendAnalyticsEmailMessage,
  validateEmailConfig
};
