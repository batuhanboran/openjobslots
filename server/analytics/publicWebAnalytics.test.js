const assert = require("node:assert/strict");

const {
  buildGoogleAnalyticsCsp,
  buildPublicWebAnalyticsHeadTags,
  readPublicWebAnalyticsConfig,
  stripPublicWebAnalyticsHeadTags
} = require("./publicWebAnalytics");

function testReadsSafeEnvConfig() {
  const config = readPublicWebAnalyticsConfig({
    OPENJOBSLOTS_GA_MEASUREMENT_ID: "g-test123",
    OPENJOBSLOTS_GSC_VERIFICATION_TOKEN: "google-site-verification=abc_DEF-123"
  });

  assert.equal(config.gaMeasurementId, "G-TEST123");
  assert.equal(config.googleSiteVerificationToken, "abc_DEF-123");
}

function testRejectsUnsafeEnvConfig() {
  const config = readPublicWebAnalyticsConfig({
    OPENJOBSLOTS_GA_MEASUREMENT_ID: "UA-OLD",
    OPENJOBSLOTS_GSC_VERIFICATION_TOKEN: "<script>alert(1)</script>"
  });

  assert.equal(config.gaMeasurementId, "");
  assert.equal(config.googleSiteVerificationToken, "");
}

function testBuildsHeadTags() {
  const tags = buildPublicWebAnalyticsHeadTags({
    gaMeasurementId: "G-TEST123",
    googleSiteVerificationToken: "abc_DEF-123"
  });

  assert.match(tags, /<meta name="google-site-verification" content="abc_DEF-123" \/>/);
  assert.match(tags, /https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-TEST123/);
  assert.match(tags, /gtag\("config", "G-TEST123"/);
}

function testStripsManagedTags() {
  const html = [
    "<head>",
    '<meta name="google-site-verification" content="abc" />',
    '<script async src="https://www.googletagmanager.com/gtag/js?id=G-OLD"></script>',
    "<script>window.dataLayer = window.dataLayer || [];</script>",
    "</head>"
  ].join("\n");

  const stripped = stripPublicWebAnalyticsHeadTags(html);

  assert.doesNotMatch(stripped, /google-site-verification/);
  assert.doesNotMatch(stripped, /googletagmanager/);
  assert.doesNotMatch(stripped, /dataLayer/);
}

function testBuildsGaCspOnlyWhenEnabled() {
  assert.deepEqual(buildGoogleAnalyticsCsp({}), {
    scriptSrc: [],
    connectSrc: [],
    imgSrc: []
  });

  assert.deepEqual(buildGoogleAnalyticsCsp({ gaMeasurementId: "G-TEST123" }), {
    scriptSrc: ["https://www.googletagmanager.com"],
    connectSrc: [
      "https://www.google-analytics.com",
      "https://analytics.google.com",
      "https://region1.google-analytics.com"
    ],
    imgSrc: ["https://www.google-analytics.com"]
  });
}

function main() {
  testReadsSafeEnvConfig();
  testRejectsUnsafeEnvConfig();
  testBuildsHeadTags();
  testStripsManagedTags();
  testBuildsGaCspOnlyWhenEnabled();
  console.log("publicWebAnalytics tests passed");
}

if (require.main === module) {
  main();
}
