const assert = require("assert");
const {
  analyzePayloadShape,
  classifySourceProtection,
  detectParserDrift,
  getSourceSyncPolicy,
  SOURCE_QUALITY_STATES,
  shapeSimilarity
} = require("./sourceQualityPolicy");

function testBadSourceAutoQuarantines() {
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
      maxMissingAnyGeoPct: 95,
      maxMissingAllGeoUnknownRemotePct: 5,
      parserFailureMinEvents: 10
    }
  });
  assert.equal(result.action, "quarantine_only");
  assert.equal(result.source_quality_state, SOURCE_QUALITY_STATES.QUARANTINE_ONLY);
  assert.ok(result.reason.includes("quarantine_pct"));
}

function testCertifiedSourceGetsNormalBudget() {
  const policy = getSourceSyncPolicy("greenhouse");
  assert.equal(policy.mode, "normal");
  assert.equal(policy.source_quality_state, SOURCE_QUALITY_STATES.PUBLIC_ENABLED);
  assert.equal(policy.public_writes_allowed, true);
  assert.equal(policy.maxTargetsPerRun, Infinity);
}

function testPartialSourceGetsCanaryBudget() {
  const policy = getSourceSyncPolicy("partial_fixture_source", {
    metadata: { parserFixtureStatus: "normalized-fixture-only" }
  });
  assert.equal(policy.mode, "canary");
  assert.equal(policy.source_quality_state, SOURCE_QUALITY_STATES.CANARY_ONLY);
  assert.ok(policy.maxTargetsPerRun > 0);
  assert.ok(Number.isFinite(policy.maxTargetsPerRun));
}

function testFallbackSourceDisabled() {
  const policy = getSourceSyncPolicy("uncertified_source", {
    metadata: { parserFixtureStatus: "pending-parser-fixture" }
  });
  assert.equal(policy.mode, "disabled");
  assert.equal(policy.source_quality_state, SOURCE_QUALITY_STATES.DISABLED);
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

function testDynamicDetailPayloadKeysDoNotCauseDrift() {
  const baseline = analyzePayloadShape({
    html: "<html></html>",
    __listUrl: "https://fixture.applytojob.com/apply",
    __sourceConfig: {
      baseOrigin: "https://fixture.applytojob.com",
      detail_fetch_count: 2,
      list_url: "https://fixture.applytojob.com/apply"
    },
    __detailHtmlByUrl: {
      "https://fixture.applytojob.com/apply/a/One": "<html>one</html>",
      "https://fixture.applytojob.com/apply/b/Two": "<html>two</html>"
    },
    __detailStatusByUrl: {
      "https://fixture.applytojob.com/apply/a/One": 200,
      "https://fixture.applytojob.com/apply/b/Two": 200
    },
    __detailFailureByUrl: {}
  });
  const observed = analyzePayloadShape({
    html: "<html></html>",
    __listUrl: "https://fixture.applytojob.com/apply",
    __sourceConfig: {
      baseOrigin: "https://fixture.applytojob.com",
      detail_fetch_count: 5,
      list_url: "https://fixture.applytojob.com/apply"
    },
    __detailHtmlByUrl: {
      "https://fixture.applytojob.com/apply/c/Three": "<html>three</html>",
      "https://fixture.applytojob.com/apply/d/Four": "<html>four</html>",
      "https://fixture.applytojob.com/apply/e/Five": "<html>five</html>",
      "https://fixture.applytojob.com/apply/f/Six": "<html>six</html>",
      "https://fixture.applytojob.com/apply/g/Seven": "<html>seven</html>"
    },
    __detailStatusByUrl: {
      "https://fixture.applytojob.com/apply/c/Three": 200,
      "https://fixture.applytojob.com/apply/d/Four": 200,
      "https://fixture.applytojob.com/apply/e/Five": 200,
      "https://fixture.applytojob.com/apply/f/Six": 200,
      "https://fixture.applytojob.com/apply/g/Seven": 200
    },
    __detailFailureByUrl: {}
  });
  const result = detectParserDrift(baseline, observed, { threshold: 0.55 });
  assert.equal(result.drift, false);
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
  assert.equal(httpFailed.source_quality_state, SOURCE_QUALITY_STATES.DISABLED);
  assert.ok(httpFailed.reason.includes("http_blocked"));
}

testBadSourceAutoQuarantines();
testCertifiedSourceGetsNormalBudget();
testPartialSourceGetsCanaryBudget();
testFallbackSourceDisabled();
testDriftDetection();
testDynamicDetailPayloadKeysDoNotCauseDrift();
testWorkerSpinGuardInputs();

console.log("source quality policy tests passed");
