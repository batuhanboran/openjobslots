const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  EVIDENCE_SOURCES,
  FAILURE_REASONS,
  decideDetailEscalation,
  makeFieldEvidence,
  mergeFieldEvidence
} = require("./parserEvidence");
const { getSourceModule } = require("./sources");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sourceFixture(atsKey, fileName) {
  return path.join(__dirname, "sources", atsKey, "fixtures", fileName);
}

test("direct JSON parser evidence uses list API fields and avoids detail escalation when complete", () => {
  const source = getSourceModule("lever");
  const company = readJson(sourceFixture("lever", "company.json"));
  const rawList = readJson(sourceFixture("lever", "list.json"));
  const row = source.normalize(source.parse(rawList, company)[0], company);

  assert.equal(row.evidence.title.evidence_source, EVIDENCE_SOURCES.LIST_API);
  assert.equal(row.evidence.country.evidence_source, EVIDENCE_SOURCES.LIST_API);
  assert.equal(row.evidence.remote_type.evidence_source, EVIDENCE_SOURCES.LIST_API);
  assert.equal(row.evidence.remote_type.normalized, "remote");
  assert.equal(row.evidence.remote_type.explicit, true);
  assert.equal(row.detail_escalation_decision.detail_not_needed, true);
});

test("labeled HTML parser evidence keeps labeled HTML provenance", () => {
  const source = getSourceModule("hrmdirect");
  const company = readJson(sourceFixture("hrmdirect", "company.json"));
  const rawList = readJson(sourceFixture("hrmdirect", "list.json"));
  const row = source.normalize(source.parse(rawList, company)[0], company);

  assert.equal(row.evidence.title.evidence_source, EVIDENCE_SOURCES.LABELED_HTML);
  assert.equal(row.evidence.city.evidence_source, EVIDENCE_SOURCES.LABELED_HTML);
  assert.equal(row.evidence.posting_date.evidence_source, EVIDENCE_SOURCES.LABELED_HTML);
  assert.equal(row.detail_escalation_decision.detail_not_needed, true);
});

test("brittle tenant parser evidence preserves detail JSON-LD provenance", async () => {
  const source = getSourceModule("icims");
  const sourceDir = path.join(__dirname, "sources", "icims");
  const company = readJson(path.join(sourceDir, "fixtures", "company.json"));
  const fixture = readJson(path.join(sourceDir, "fixtures", "route-detection.json"));
  const responses = new Map([
    [fixture.wrapper_url, fixture.wrapper_html],
    [fixture.iframe_url, fixture.list_html],
    [fixture.detail_url, fixture.detail_html]
  ]);

  const raw = await source.fetchList(company, {
    fetcher: async (url) => responses.get(url)
  });
  const row = source.normalize(source.parse(raw, company)[0], company);

  assert.equal(row.evidence.country.evidence_source, EVIDENCE_SOURCES.JSON_LD);
  assert.equal(row.evidence.city.evidence_source, EVIDENCE_SOURCES.JSON_LD);
  assert.equal(row.evidence.remote_type.evidence_source, EVIDENCE_SOURCES.LABELED_HTML);
  assert.equal(row.evidence.posting_date.evidence_source, EVIDENCE_SOURCES.JSON_LD);
  assert.equal(row.detail_escalation_decision.detail_not_needed, true);
});

test("field evidence merge keeps stronger source evidence over weaker body text", () => {
  const merged = mergeFieldEvidence(
    {
      city: makeFieldEvidence("city", "Austin", {
        source: "labeled_html",
        confidence: 0.7,
        rule_name: "labeled_location"
      })
    },
    {
      city: makeFieldEvidence("city", "Austin", {
        source: "generic_body_text",
        confidence: 0.99,
        rule_name: "description_body_guess"
      })
    }
  );

  assert.equal(merged.city.evidence_source, EVIDENCE_SOURCES.LABELED_HTML);
});

test("field evidence merge lets explicit remote beat inferred onsite", () => {
  const merged = mergeFieldEvidence(
    {
      remote_type: makeFieldEvidence("remote_type", "onsite", {
        source: "normalized",
        confidence: 0.9,
        rule_name: "inferred_onsite_from_physical_location"
      })
    },
    {
      remote_type: makeFieldEvidence("remote_type", "hybrid", {
        source: "labeled_html",
        confidence: 0.7,
        rule_name: "explicit_workplace_type"
      })
    }
  );

  assert.equal(merged.remote_type.value, "hybrid");
});

test("detail escalation explains missing list geo and remote evidence", () => {
  const decision = decideDetailEscalation(
    {
      ats_key: "lever",
      source_family: "direct_json",
      position_name: "Engineer",
      company_name: "Fixture",
      canonical_url: "https://jobs.example.test/1",
      remote_type: "unknown"
    },
    { sourceFamily: "direct_json", detailSupported: false }
  );

  assert.equal(decision.detail_not_supported, true);
  assert.ok(decision.failure_reasons.includes(FAILURE_REASONS.LIST_MISSING_LOCATION));
  assert.ok(decision.failure_reasons.includes(FAILURE_REASONS.LIST_MISSING_REMOTE));
  assert.ok(decision.failure_reasons.includes(FAILURE_REASONS.DETAIL_REQUIRED_BUT_UNAVAILABLE));
});

console.log("parser evidence tests passed");
