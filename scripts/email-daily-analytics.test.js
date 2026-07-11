const assert = require("node:assert/strict");

process.env.ANALYTICS_REPORT_TO = "reports@example.com";

const {
  buildAnalyticsEmailMessage,
  calculateZeroResultRate,
  createSampleAnalyticsReport,
  fetchCloudflareTrafficSummary,
  parseArgs,
  readEmailConfig,
  readPublicFeedback
} = require("./email-daily-analytics");

function testParseArgsDefaultsToDryRunFalseAndIstanbul() {
  const options = parseArgs([], {});
  assert.equal(options.date, "today");
  assert.equal(options.timezone, "Europe/Istanbul");
  assert.equal(options.dryRun, false);
  assert.equal(options.sample, false);
}

function testReadEmailConfigUsesSafeDefaultRecipient() {
  const config = readEmailConfig({
    OPENJOBSLOTS_ANALYTICS_EMAIL_FROM: "reports@openjobslots.com",
    OPENJOBSLOTS_SMTP_HOST: "smtp.example.com",
    OPENJOBSLOTS_SMTP_PORT: "465",
    OPENJOBSLOTS_SMTP_USER: "user",
    OPENJOBSLOTS_SMTP_PASS: "secret"
  });

  assert.equal(config.to, "reports@example.com");
  assert.equal(config.from, "reports@openjobslots.com");
  assert.equal(config.smtp.host, "smtp.example.com");
  assert.equal(config.smtp.port, 465);
  assert.equal(config.smtp.secure, true);
}

function testBuildAnalyticsEmailMessage() {
  const report = createSampleAnalyticsReport({
    date: "2026-05-22",
    timezone: "Europe/Istanbul"
  });
  report.top_normalized_queries = [
    { query: "te", count: 19 },
    { query: "tec", count: 13 }
  ];
  report.top_final_posting_searches = [
    { query: "technical support engineer", count: 7 },
    { query: "remote jobs", count: 4 }
  ];
  const message = buildAnalyticsEmailMessage(report, {
    to: "reports@example.com",
    from: "reports@openjobslots.com"
  });

  assert.equal(message.to, "reports@example.com");
  assert.equal(message.from, "reports@openjobslots.com");
  assert.match(message.subject, /OpenJobSlots analytics:daily 2026-05-22/);
  assert.match(message.text, /Demand snapshot/);
  assert.match(message.text, /Top queries: technical support engineer \(7\), remote jobs \(4\)/);
  assert.doesNotMatch(message.text, /Top queries: te \(19\)/);
  assert.match(message.html, /Top query<\/div><div[^>]*>technical support engineer/);
  assert.match(message.text, /Top countries: United States \(96\), Turkey \(42\)/);
  assert.match(message.text, /Remote intent: remote=312, hybrid=96, non_remote=41/);
  assert.match(message.text, /Search gaps/);
  assert.match(message.text, /Zero-result queries: wordpress developer \(18\)/);
  assert.match(message.text, /Traffic snapshot/);
  assert.match(message.text, /Cloudflare: visits=487, requests=1,432, bandwidth=175\.9 MB/);
  assert.match(message.text, /Top edge paths: \/ \(612\), \/postings \(338\)/);
  assert.match(message.text, /Edge cache: dynamic=910, none=321, miss=143/);
  assert.match(message.text, /Devices: desktop=992, mobile=438, tablet=2/);
  assert.match(message.html, /<h2>Demand snapshot<\/h2>/);
  assert.match(message.html, /Cloudflare edge/);
  assert.doesNotMatch(message.text, /secret/);
}

function testFeedbackSectionInEmailBodies() {
  const report = createSampleAnalyticsReport({
    date: "2026-05-22",
    timezone: "Europe/Istanbul"
  });
  const message = buildAnalyticsEmailMessage(report, {
    to: "reports@example.com",
    from: "reports@openjobslots.com"
  });

  assert.match(message.text, /User feedback \(2\)/);
  assert.match(message.text, /Helpful — "Great search, found a job in minutes" \(\/ara\)/);
  assert.match(message.html, /<h2>User feedback \(2\)<\/h2>/);
  assert.match(message.html, /Something&#39;s wrong|Something's wrong/);

  report.public_feedback = { ok: true, count: 0, items: [] };
  const empty = buildAnalyticsEmailMessage(report, {
    to: "reports@example.com",
    from: "reports@openjobslots.com"
  });
  assert.match(empty.text, /User feedback \(0\)\n- none today/);
}

function testReadPublicFeedbackFiltersEventAndWindow() {
  const now = new Date("2026-05-22T12:00:00.000Z");
  // Istanbul day 2026-05-22 = 2026-05-21T21:00Z .. now (today report).
  const lines = [
    JSON.stringify({ timestamp: "2026-05-22T09:00:00.000Z", level: "info", event: "public_feedback", message: "in window", context: { rating: "feedback.r1", path: "/ara" } }),
    JSON.stringify({ timestamp: "2026-05-22T09:05:00.000Z", level: "info", event: "public_feedback", message: "legacy rating", context: { rating: "Yardımcı oldu" } }),
    JSON.stringify({ timestamp: "2026-05-20T09:00:00.000Z", level: "info", event: "public_feedback", message: "too old", context: { rating: "feedback.r2" } }),
    JSON.stringify({ timestamp: "2026-05-22T09:10:00.000Z", level: "info", event: "search_error", message: "not feedback", context: {} }),
    "{not json"
  ].join("\n");
  const fakeFs = { readFileSync: () => lines };

  const feedback = readPublicFeedback(
    { date: "today", timezone: "Europe/Istanbul" },
    { DB_PATH: "/data/jobs.db" },
    fakeFs,
    now
  );

  assert.equal(feedback.ok, true);
  assert.equal(feedback.count, 2);
  assert.equal(feedback.items[0].rating, "Helpful");
  assert.equal(feedback.items[0].message, "in window");
  assert.equal(feedback.items[0].path, "/ara");
  assert.equal(feedback.items[1].rating, "Yardımcı oldu");
  assert.equal(feedback.log_path.replace(/\\/g, "/"), "/data/logs/frontend-client.log");

  const missing = readPublicFeedback(
    { date: "today", timezone: "Europe/Istanbul" },
    { DB_PATH: "/data/jobs.db" },
    { readFileSync: () => { const e = new Error("gone"); e.code = "ENOENT"; throw e; } },
    now
  );
  assert.equal(missing.ok, true);
  assert.equal(missing.count, 0);
}

function testZeroResultRateUsesKnownResultBuckets() {
  const report = createSampleAnalyticsReport({
    date: "2026-05-22",
    timezone: "Europe/Istanbul"
  });
  report.total_events = 2000;
  report.result_count_distribution = {
    zero_result: 10,
    low_result: 90,
    normal_result: 900,
    unknown_result: 1000
  };

  const message = buildAnalyticsEmailMessage(report, {
    to: "reports@example.com",
    from: "reports@openjobslots.com"
  });

  assert.equal(calculateZeroResultRate(report), 0.01);
  assert.match(message.text, /Zero-result rate: 1\.0% \(10 zero-result searches\)/);
  assert.match(message.html, /Zero-result rate<\/div><div[^>]*>1\.0%/);
}

async function testFetchCloudflareTrafficSummaryUsesReadOnlyGraphql() {
  const calls = [];
  const summary = await fetchCloudflareTrafficSummary(
    { date: "2026-05-22", timezone: "Europe/Istanbul" },
    {
      token: "token",
      zoneId: "zone123",
      zoneName: "openjobslots.com"
    },
    async (url, options) => {
      calls.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            data: {
              viewer: {
                zones: [{
                  totals: [{ count: 12, sum: { visits: 4, edgeResponseBytes: 2048 }, ratio: { status4xx: 0.2, status5xx: 0 } }],
                  countries: [{ count: 7, dimensions: { clientCountryName: "US" } }, { count: 5, dimensions: { clientCountryName: "TR" } }],
                  statuses: [{ count: 10, dimensions: { edgeResponseStatus: 200 } }, { count: 2, dimensions: { edgeResponseStatus: 404 } }],
                  cache: [{ count: 8, dimensions: { cacheStatus: "dynamic" } }, { count: 4, dimensions: { cacheStatus: "none" } }],
                  paths: [{ count: 6, dimensions: { clientRequestPath: "/" } }, { count: 3, dimensions: { clientRequestPath: "/postings" } }],
                  devices: [{ count: 9, dimensions: { clientDeviceType: "desktop" } }],
                  browsers: [{ count: 8, dimensions: { userAgentBrowser: "Chrome" } }]
                }]
              }
            }
          };
        }
      };
    }
  );

  assert.equal(summary.ok, true);
  assert.equal(summary.visits, 4);
  assert.equal(summary.requests, 12);
  assert.equal(summary.bandwidth_bytes, 2048);
  assert.deepEqual(summary.top_countries, [{ code: "US", count: 7 }, { code: "TR", count: 5 }]);
  assert.deepEqual(summary.top_paths, [{ path: "/", count: 6 }, { path: "/postings", count: 3 }]);
  assert.deepEqual(summary.cache_statuses, [{ status: "dynamic", count: 8 }, { status: "none", count: 4 }]);
  assert.equal(summary.status4xx_ratio, 0.2);
  assert.match(calls[0].url, /\/graphql/);
  assert.equal(calls[0].options.headers.Authorization, "Bearer token");
}

async function main() {
  testParseArgsDefaultsToDryRunFalseAndIstanbul();
  testReadEmailConfigUsesSafeDefaultRecipient();
  testBuildAnalyticsEmailMessage();
  testFeedbackSectionInEmailBodies();
  testReadPublicFeedbackFiltersEventAndWindow();
  testZeroResultRateUsesKnownResultBuckets();
  await testFetchCloudflareTrafficSummaryUsesReadOnlyGraphql();
  console.log("email-daily-analytics tests passed");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
