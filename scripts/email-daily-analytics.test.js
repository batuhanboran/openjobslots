const assert = require("node:assert/strict");

const {
  buildAnalyticsEmailMessage,
  createSampleAnalyticsReport,
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
  assert.match(message.text, /Backend public search events: total=/);
  assert.match(message.text, /Search Console: configure property/);
  assert.match(message.text, /Google Analytics: enabled when OPENJOBSLOTS_GA_MEASUREMENT_ID is set/);
  assert.doesNotMatch(message.text, /secret/);
}

function main() {
  testParseArgsDefaultsToDryRunFalseAndIstanbul();
  testReadEmailConfigUsesSafeDefaultRecipient();
  testBuildAnalyticsEmailMessage();
  console.log("email-daily-analytics tests passed");
}

if (require.main === module) {
  main();
}
