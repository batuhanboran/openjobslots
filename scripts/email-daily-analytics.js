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
    ]
  };
}

function buildAnalyticsEmailMessage(report, config) {
  const text = [
    formatReport(report),
    "",
    "External acquisition:",
    "- Search Console: configure property and use its Performance report for Google queries, impressions, clicks, and landing pages.",
    "- Google Analytics: enabled when OPENJOBSLOTS_GA_MEASUREMENT_ID is set; GA4 receives aggregate page, search, filter, and apply-click events.",
    "- Backend referrers above are first-party public_search_events only; they do not include full URLs, IPs, emails, or raw user agents."
  ].join("\n");

  return {
    to: config.to,
    from: config.from,
    subject: `OpenJobSlots analytics:daily ${report.date} (${report.timezone})`,
    text
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
    return await getPostgresPublicSearchReport(pool, options);
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
  parseArgs,
  readEmailConfig,
  sendAnalyticsEmailMessage,
  validateEmailConfig
};
