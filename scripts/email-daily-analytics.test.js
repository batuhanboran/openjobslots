const assert = require("node:assert/strict");

const {
  buildAnalyticsEmailMessage,
  createSampleAnalyticsReport,
  fetchCloudflareTrafficSummary,
  parseArgs,
  readEmailConfig
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

  assert.equal(config.to, "maintainer@example.com");
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
  const message = buildAnalyticsEmailMessage(report, {
    to: "maintainer@example.com",
    from: "reports@openjobslots.com"
  });

  assert.equal(message.to, "maintainer@example.com");
  assert.equal(message.from, "reports@openjobslots.com");
  assert.match(message.subject, /OpenJobSlots analytics:daily 2026-05-22/);
  assert.match(message.text, /Demand snapshot/);
  assert.match(message.text, /Top countries: United States \(96\), Turkey \(42\)/);
  assert.match(message.text, /Remote intent: remote=312, hybrid=96, non_remote=41/);
  assert.match(message.text, /Traffic snapshot/);
  assert.match(message.text, /Cloudflare: visitors=487, pageviews=712, requests=1,432/);
  assert.match(message.html, /<h2>Demand snapshot<\/h2>/);
  assert.match(message.html, /Cloudflare edge/);
  assert.doesNotMatch(message.text, /secret/);
}

async function testFetchCloudflareTrafficSummaryUsesReadOnlyDashboard() {
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
            success: true,
            result: {
              totals: {
                requests: {
                  all: 12,
                  cached: 8,
                  country: { US: 7, TR: 5 },
                  http_status: { "200": 10, "404": 2 }
                },
                pageviews: { all: 6 },
                uniques: { all: 4 },
                threats: { all: 1 },
                bandwidth: { all: 2048 }
              }
            }
          };
        }
      };
    }
  );

  assert.equal(summary.ok, true);
  assert.equal(summary.visitors, 4);
  assert.equal(summary.pageviews, 6);
  assert.equal(summary.requests, 12);
  assert.equal(summary.cached_requests, 8);
  assert.deepEqual(summary.top_countries, [{ code: "US", count: 7 }, { code: "TR", count: 5 }]);
  assert.match(calls[0].url, /\/zones\/zone123\/analytics\/dashboard/);
  assert.equal(calls[0].options.headers.Authorization, "Bearer token");
}

async function main() {
  testParseArgsDefaultsToDryRunFalseAndIstanbul();
  testReadEmailConfigUsesSafeDefaultRecipient();
  testBuildAnalyticsEmailMessage();
  await testFetchCloudflareTrafficSummaryUsesReadOnlyDashboard();
  console.log("email-daily-analytics tests passed");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
