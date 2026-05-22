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

function formatPercent(value) {
  if (!Number.isFinite(Number(value))) return "n/a";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function formatQueryList(items = [], key = "query") {
  if (!Array.isArray(items) || items.length === 0) return "none";
  return items.map((item) => `${item[key]} (${formatCount(item.count)})`).join(", ");
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

function toTopCountryRows(countryCounts = {}) {
  return Object.entries(countryCounts || {})
    .map(([code, count]) => ({ code: String(code || "").trim().toUpperCase(), count: Number(count || 0) }))
    .filter((item) => item.code)
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
    .slice(0, 10);
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
  const url = new URL(`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(config.zoneId)}/analytics/dashboard`);
  url.searchParams.set("since", String(range.since));
  url.searchParams.set("until", String(range.until));
  url.searchParams.set("continuous", "false");

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json"
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.success === false) {
      const firstError = payload?.errors?.[0];
      const message = firstError?.message || response.statusText || "request failed";
      return {
        ok: false,
        status: response.status,
        unavailable_reason: `Cloudflare analytics unavailable (${response.status} ${message})`
      };
    }

    const totals = payload?.result?.totals || {};
    return {
      ok: true,
      source: "cloudflare_zone_analytics",
      zone_name: config.zoneName,
      visitors: Number(totals.uniques?.all || 0),
      pageviews: Number(totals.pageviews?.all || 0),
      requests: Number(totals.requests?.all || 0),
      cached_requests: Number(totals.requests?.cached || 0),
      threats: Number(totals.threats?.all || 0),
      bandwidth_bytes: Number(totals.bandwidth?.all || 0),
      top_countries: toTopCountryRows(totals.requests?.country || {}),
      status_codes: totals.requests?.http_status || {},
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
      source: "cloudflare_zone_analytics",
      visitors: 487,
      pageviews: 712,
      requests: 1432,
      cached_requests: 971,
      threats: 3,
      bandwidth_bytes: 184392114,
      top_countries: [
        { code: "US", count: 612 },
        { code: "TR", count: 338 },
        { code: "DE", count: 121 }
      ],
      status_codes: { "200": 1208, "301": 118, "404": 19, "403": 3 }
    }
  };
}

function formatCloudflareTrafficText(traffic = {}) {
  if (!traffic || traffic.ok !== true) {
    const reason = traffic?.unavailable_reason || "not configured";
    return `Cloudflare: unavailable (${reason})`;
  }
  return [
    `Cloudflare: visitors=${formatCount(traffic.visitors)}, pageviews=${formatCount(traffic.pageviews)}, requests=${formatCount(traffic.requests)}`,
    `Edge countries: ${formatQueryList(traffic.top_countries || [], "code")}`,
    `Status codes: ${Object.entries(traffic.status_codes || {}).map(([code, count]) => `${code}=${formatCount(count)}`).join(", ") || "none"}`
  ].join("\n");
}

function buildAnalyticsEmailText(report) {
  const resultCounts = report.result_count_distribution || {};
  const zeroRate = Number(report.total_events || 0) > 0
    ? Number(resultCounts.zero_result || 0) / Number(report.total_events || 0)
    : null;

  return [
    `OpenJobSlots analytics:daily - ${report.date} (${report.timezone})`,
    "",
    "Executive snapshot",
    `- Backend events: ${formatCount(report.total_events)} from ${formatCount(report.anonymous_session_count)} anonymous sessions`,
    `- Zero-result rate: ${formatPercent(zeroRate)} (${formatCount(resultCounts.zero_result || 0)} zero-result searches)`,
    `- Cache hit rate: ${formatPercent(report.cache_hit_rate)}`,
    "",
    "Demand snapshot",
    `- Top queries: ${formatQueryList(report.top_normalized_queries || report.top_terms)}`,
    `- Top final searches: ${formatQueryList(report.top_final_posting_searches)}`,
    `- Top countries: ${formatQueryList(report.top_country_filters || [], "value")}`,
    `- Remote intent: ${formatRemoteIntent(report.remote_filter_counts || {})}`,
    `- Result buckets: ${formatResultBuckets(resultCounts)}`,
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
  const zeroRate = Number(report.total_events || 0) > 0
    ? Number(resultCounts.zero_result || 0) / Number(report.total_events || 0)
    : null;
  const traffic = report.cloudflare_traffic || {};
  const cloudflareSummary = traffic.ok === true
    ? `${formatCount(traffic.visitors)} visitors / ${formatCount(traffic.pageviews)} pageviews / ${formatCount(traffic.requests)} requests`
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
    metricCard("Top query", (report.top_normalized_queries || report.top_terms || [])[0]?.query || "none"),
    '</tr>',
    '</table>',
    '<h2>Demand snapshot</h2>',
    '<h3>Top queries</h3><ol>',
    listItems(report.top_normalized_queries || report.top_terms),
    '</ol>',
    '<h3>Top countries</h3><ol>',
    listItems(report.top_country_filters || [], "value"),
    '</ol>',
    `<p><strong>Remote intent:</strong> ${escapeHtml(formatRemoteIntent(report.remote_filter_counts || {}))}</p>`,
    `<p><strong>Result buckets:</strong> ${escapeHtml(formatResultBuckets(resultCounts))}</p>`,
    '<h2>Traffic snapshot</h2>',
    `<p><strong>Cloudflare edge:</strong> ${escapeHtml(cloudflareSummary)}</p>`,
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
  parseArgs,
  readCloudflareConfig,
  readEmailConfig,
  sendAnalyticsEmailMessage,
  validateEmailConfig
};
