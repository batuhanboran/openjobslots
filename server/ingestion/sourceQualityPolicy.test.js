const assert = require("assert");
const {
  analyzePayloadShape,
  classifySourceProtection,
  detectParserDrift,
  getSourceSyncPolicy,
  shapeSimilarity
} = require("./sourceQualityPolicy");

function testBadSourceAutoDisables() {
  const result = classifySourceProtection({
    ats_key: "dirty",
    accepted_rows: 10,
    quarantined_rows: 90,
    rejected_rows: 0,
    visible_rows: 10,
    missing_country_count: 10,
    missing_city_count: 10,
    unknown_remote_count: 10
  }, {
    thresholds: {
      minRows: 50,
      maxQuarantinePct: 70,
      maxRejectedPct: 30,
      maxMissingCountryPct: 95,
      maxMissingCityPct: 98,
      maxUnknownRemotePct: 95,
      maxParserFailurePct: 50,
      maxHttpFailurePct: 50,
      parserFailureMinEvents: 10
    }
  });
  assert.equal(result.action, "disable");
  assert.ok(result.reason.includes("quarantine_pct"));
}

function testCertifiedSourceGetsNormalBudget() {
  const policy = getSourceSyncPolicy("greenhouse");
  assert.equal(policy.mode, "normal");
  assert.equal(policy.maxTargetsPerRun, Infinity);
}

function testPartialSourceGetsCanaryBudget() {
  const policy = getSourceSyncPolicy("partial_fixture_source", {
    metadata: { parserFixtureStatus: "normalized-fixture-only" }
  });
  assert.equal(policy.mode, "canary");
  assert.ok(policy.maxTargetsPerRun > 0);
  assert.ok(Number.isFinite(policy.maxTargetsPerRun));
}

function testFallbackSourceDisabled() {
  const policy = getSourceSyncPolicy("uncertified_source", {
    metadata: { parserFixtureStatus: "pending-parser-fixture" }
  });
  assert.equal(policy.mode, "disabled");
  assert.equal(policy.maxTargetsPerRun, 0);
}

function testDriftDetection() {
  const baseline = analyzePayloadShape({
    jobs: [
      {
        id: "1",
        title: "Engineer",
        location: { city: "Istanbul", country: "Türkiye" }
      }
    ]
  });
  const similar = analyzePayloadShape({
    jobs: [
      {
        id: "2",
        title: "Designer",
        location: { city: "Berlin", country: "Germany" }
      }
    ]
  });
  const drifted = analyzePayloadShape({
    html: "<html></html>",
    paging: { next: null }
  });
  assert.equal(detectParserDrift(baseline, similar, { threshold: 0.55 }).drift, false);
  assert.equal(detectParserDrift(baseline, drifted, { threshold: 0.55 }).drift, true);
  assert.ok(shapeSimilarity(baseline.shape_paths, similar.shape_paths) > 0.9);
}

function testWorkerSpinGuardInputs() {
  const httpFailed = classifySourceProtection({
    ats_key: "blocked",
    accepted_rows: 0,
    quarantined_rows: 0,
    rejected_rows: 0,
    http_failure_events: 25
  }, {
    thresholds: {
      parserFailureMinEvents: 10,
      maxHttpFailurePct: 50
    }
  });
  assert.equal(httpFailed.action, "disable");
}

testBadSourceAutoDisables();
testCertifiedSourceGetsNormalBudget();
testPartialSourceGetsCanaryBudget();
testFallbackSourceDisabled();
testDriftDetection();
testWorkerSpinGuardInputs();

console.log("source quality policy tests passed");
