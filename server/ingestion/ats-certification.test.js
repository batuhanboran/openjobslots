const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { ATS_FILTER_OPTION_ITEMS, normalizeSyncEnabledAts } = require("../index");
const { PARSER_FIXTURE_BACKED, UNSUPPORTED_ATS } = require("./adapter-metadata");
const {
  CERTIFICATION_VERSION,
  FIELD_NAMES,
  buildAtsCertificationRecords,
  validateCertificationRecord
} = require("./ats-certification");

test("ATS field certification registry covers every configured ATS", () => {
  const atsKeys = ATS_FILTER_OPTION_ITEMS.map((item) => item.value).sort();
  const records = buildAtsCertificationRecords(atsKeys);
  assert.deepEqual(Object.keys(records).sort(), atsKeys);
  assert.equal(Object.keys(records).length, 67);

  const errors = [];
  for (const atsKey of atsKeys) {
    errors.push(...validateCertificationRecord(records[atsKey]));
    assert.equal(records[atsKey].version, CERTIFICATION_VERSION);
    assert.equal(records[atsKey].key, atsKey);
    for (const fieldName of FIELD_NAMES) {
      assert.ok(records[atsKey].fieldDecisions[fieldName], `${atsKey} missing ${fieldName}`);
    }
  }

  assert.deepEqual(errors, []);
});

test("only raw parser fixture backed ATS can claim parser fixture certification", () => {
  const records = buildAtsCertificationRecords(ATS_FILTER_OPTION_ITEMS.map((item) => item.value));
  for (const [atsKey, record] of Object.entries(records)) {
    if (record.certificationStatus === "parser-fixture-backed") {
      assert.equal(PARSER_FIXTURE_BACKED.has(atsKey), true, `${atsKey} cannot claim parser fixture certification`);
    }
    if (!PARSER_FIXTURE_BACKED.has(atsKey) && !UNSUPPORTED_ATS.has(atsKey)) {
      assert.notEqual(record.certificationStatus, "parser-fixture-backed", `${atsKey} needs raw source fixture coverage first`);
    }
  }
});

test("date certification never allows invented URL or title inference", () => {
  const records = buildAtsCertificationRecords(ATS_FILTER_OPTION_ITEMS.map((item) => item.value));
  for (const record of Object.values(records)) {
    assert.notEqual(
      record.fieldDecisions.date.status,
      "url-or-title-inference",
      `${record.key} must not infer posting dates from URL/title`
    );
  }
});

test("dayforcehcm parser certification stays disabled by sync defaults", () => {
  const records = buildAtsCertificationRecords(ATS_FILTER_OPTION_ITEMS.map((item) => item.value));
  assert.equal(records.dayforcehcm.certificationStatus, "parser-fixture-backed");
  assert.equal(records.dayforcehcm.fieldDecisions.geo.status, "list-payload");
  assert.equal(records.dayforcehcm.fieldDecisions.date.status, "list-payload");
  assert.equal(records.dayforcehcm.fieldDecisions.remote.status, "list-payload");
  assert.equal(records.dayforcehcm.fieldDecisions.sourceId.status, "list-payload");
  assert.equal(normalizeSyncEnabledAts().includes("dayforcehcm"), false);
});

test("configured-disabled direct sources document title-only remote quarantine", () => {
  const records = buildAtsCertificationRecords(ATS_FILTER_OPTION_ITEMS.map((item) => item.value));
  for (const atsKey of ["personio", "workable"]) {
    assert.equal(records[atsKey].fieldDecisions.remote.status, "list-payload");
    assert.match(records[atsKey].fieldDecisions.remote.evidence, /title-only remote text is quarantined/i);
  }
});

test("jobicy certification forbids canonical URL source identity", () => {
  const records = buildAtsCertificationRecords(["jobicy"]);
  assert.equal(records.jobicy.fieldDecisions.sourceId.status, "list-payload");
  assert.match(records.jobicy.fieldDecisions.sourceId.evidence, /non-URL Jobicy id\/guid/i);
  assert.match(records.jobicy.fieldDecisions.sourceId.evidence, /never promoted/i);
});

test("remoteok certification requires negative remote evidence to override the board label", () => {
  const records = buildAtsCertificationRecords(["remoteok"]);
  assert.match(records.remoteok.fieldDecisions.remote.evidence, /negative work-mode text overrides/i);
  assert.match(records.remoteok.fieldDecisions.sourceId.evidence, /explicit Remote OK API id/i);
});

test("remotejobsorg certification preserves explicit source identity and negative remote evidence", () => {
  const records = buildAtsCertificationRecords(["remotejobsorg"]);
  assert.match(records.remotejobsorg.fieldDecisions.remote.evidence, /Negative work-mode text overrides/i);
  assert.match(records.remotejobsorg.fieldDecisions.sourceId.evidence, /explicit non-URL RemoteJobs\.org API id/i);
});

test("lane documentation exists for the configured-source certification program", () => {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const requiredDocs = [
    "docs/reference/ats-certification/README.md",
    "docs/direct-json-api-ats-field-certification.json",
    "docs/reference/ats-certification/enterprise-direct.md",
    "docs/reference/ats-certification/embedded-boards.md",
    "docs/reference/ats-certification/vendor-specific.md",
    "docs/reference/ats-certification/public-education.md"
  ];
  for (const relativePath of requiredDocs) {
    const fullPath = path.join(repoRoot, relativePath);
    assert.equal(fs.existsSync(fullPath), true, `${relativePath} should exist`);
    assert.ok(fs.statSync(fullPath).size > 100, `${relativePath} should not be empty`);
  }

  const directJson = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "docs/direct-json-api-ats-field-certification.json"), "utf8")
  );
  assert.equal(Object.keys(directJson.records || {}).length, 14);
  assert.deepEqual(
    Object.keys(directJson.records || {}).sort(),
    [
      "ashby",
      "bamboohr",
      "fountain",
      "freshteam",
      "getro",
      "greenhouse",
      "lever",
      "personio",
      "pinpointhq",
      "recruitcrm",
      "recruitee",
      "smartrecruiters",
      "teamtailor",
      "workable"
    ].sort()
  );
});
