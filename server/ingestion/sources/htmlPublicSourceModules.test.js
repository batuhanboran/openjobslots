const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluatePublicPosting } = require("../publicPostingGate");
const { getSourceModule } = require("./index");

const HTML_PUBLIC_SOURCES = Object.freeze([
  "applitrack",
  "hirebridge",
  "jobvite",
  "careerplug",
  "talentreef",
  "hrmdirect",
  "breezy",
  "applytojob"
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

for (const atsKey of HTML_PUBLIC_SOURCES) {
  test(`${atsKey} html/public source module parses fixture with strict evidence`, () => {
    const source = getSourceModule(atsKey);
    assert.ok(source, `expected source module ${atsKey}`);
    const sourceDir = path.join(__dirname, atsKey);
    const company = readJson(path.join(sourceDir, "fixtures", "company.json"));
    const rawList = readJson(path.join(sourceDir, "fixtures", "list.json"));
    const expectedRows = readJson(path.join(sourceDir, "fixtures", "expected-normalized.json"));

    const discovered = source.discover(company);
    assert.equal(discovered.ats_key, atsKey);
    assert.ok(source.parserVersion.startsWith(`source-${atsKey}-v`));
    assert.ok(["html_detail", "public_sector"].includes(discovered.source_family));
    assert.ok(source.rateLimit().requestsPerMinute <= 8);

    const parsed = source.parse(rawList, company);
    assert.equal(parsed.length, expectedRows.length, `${atsKey} parsed fixture count should match`);
    const normalized = parsed.map((posting) => source.normalize(posting, company));

    for (let index = 0; index < expectedRows.length; index += 1) {
      const row = normalized[index];
      const expected = expectedRows[index];
      assert.equal(source.validate(row).ok, true);
      assert.equal(row.ats_key, atsKey);
      assert.equal(row.parser_key, atsKey);
      assert.equal(row.parser_version, source.parserVersion);
      assert.equal(typeof row.parser_confidence, "number");
      assert.equal(typeof row.confidence_score, "number");
      assert.ok(row.evidence?.title?.present);
      assert.ok(row.evidence?.company?.present);
      assert.ok(row.evidence?.canonical_url?.present);
      assert.equal(row.source_job_id, expected.source_job_id);
      assert.equal(row.company_name, expected.company_name);
      assert.equal(row.position_name, expected.position_name);
      assert.equal(row.country, expected.country || "");
      if (expected.city) assert.equal(row.city, expected.city);
      assert.equal(row.remote_type, expected.remote_type || "unknown");
      if (expected.posting_date) assert.equal(row.posting_date, expected.posting_date);
      assert.equal(row.parser_confidence, expected.parser_confidence);
      const gate = evaluatePublicPosting(row, { parserVersion: source.parserVersion });
      assert.equal(gate.status, "accepted", `${atsKey} valid fixture should pass public gate`);
    }
  });

  test(`${atsKey} html/public source module rejects or quarantines invalid source shapes`, () => {
    const source = getSourceModule(atsKey);
    const sourceDir = path.join(__dirname, atsKey);
    const company = readJson(path.join(sourceDir, "fixtures", "company.json"));
    const invalid = readJson(path.join(sourceDir, "fixtures", "invalid-shapes.json"));

    for (const item of invalid.cases) {
      const normalized = source.normalize(item.posting, company);
      const basic = source.validate(normalized);
      const gate = evaluatePublicPosting(normalized, { parserVersion: source.parserVersion });
      if (item.expected === "rejected") {
        assert.equal(basic.ok, false, `${atsKey} ${item.name} should fail validation`);
        assert.match(basic.error, new RegExp(item.reason));
      } else {
        assert.equal(basic.ok, true, `${atsKey} ${item.name} should pass basic validation`);
        assert.equal(gate.status, "quarantined", `${atsKey} ${item.name} should be quarantined`);
        assert.ok(
          gate.reason_codes.some((reason) => new RegExp(item.reason).test(reason)),
          `${atsKey} ${item.name} should include ${item.reason}`
        );
      }
    }
  });
}

test("target html/public ATS modules return no postings for empty raw payloads", () => {
  for (const atsKey of ["applitrack", "applytojob", "breezy"]) {
    const source = getSourceModule(atsKey);
    const company = readJson(path.join(__dirname, atsKey, "fixtures", "company.json"));
    assert.deepEqual(source.parse({ html: "" }, company), [], atsKey);
  }
});

test("applitrack source module enriches Output.asp rows from deterministic detail pages", async () => {
  const source = getSourceModule("applitrack");
  const sourceDir = path.join(__dirname, "applitrack");
  const fixture = readJson(path.join(sourceDir, "fixtures", "route-detection.json"));

  const raw = await source.fetchList(fixture.company, {
    fetcher: async (url) => {
      const value = String(url || "");
      if (/Output\.asp/i.test(value)) return { html: fixture.output_html, status: 200, url: value };
      const parsed = new URL(value);
      const jobId = parsed.searchParams.get("AppliTrackJobId");
      if (fixture.details[jobId]) return { html: fixture.details[jobId], status: 200, url: value };
      return { html: "", status: fixture.stale_detail_status, url: value };
    }
  });
  const parsed = source.parse(raw, fixture.company);
  assert.equal(parsed.length, 3);
  const normalized = parsed.map((posting) => source.normalize(posting, fixture.company));
  const byId = Object.fromEntries(normalized.map((posting) => [posting.source_job_id, posting]));

  assert.equal(byId["7001"].country, fixture.expected["7001"].country);
  assert.equal(byId["7001"].city, fixture.expected["7001"].city);
  assert.equal(byId["7001"].remote_type, fixture.expected["7001"].remote_type);
  assert.equal(evaluatePublicPosting(byId["7001"], { parserVersion: source.parserVersion }).status, "accepted");

  assert.equal(byId["7002"].country, fixture.expected["7002"].country);
  assert.equal(byId["7002"].remote_type, fixture.expected["7002"].remote_type);
  assert.equal(evaluatePublicPosting(byId["7002"], { parserVersion: source.parserVersion }).status, "accepted");

  assert.equal(byId["7003"].location_text, "District Wide");
  assert.ok(byId["7003"].source_failure_reasons.includes(fixture.expected["7003"].reason));
  assert.equal(evaluatePublicPosting(byId["7003"], { parserVersion: source.parserVersion }).status, "quarantined");
});

test("applytojob source module enriches list rows from JSON-LD and labeled detail pages", async () => {
  const source = getSourceModule("applytojob");
  const sourceDir = path.join(__dirname, "applytojob");
  const fixture = readJson(path.join(sourceDir, "fixtures", "route-detection.json"));

  const raw = await source.fetchList(fixture.company, {
    fetcher: async (url) => {
      const value = String(url || "");
      if (value.endsWith("/apply")) return { html: fixture.list_html, status: 200, url: value };
      const parsed = new URL(value);
      const jobId = parsed.pathname.split("/").filter(Boolean)[1];
      if (fixture.details[jobId]) return { html: fixture.details[jobId], status: 200, url: value };
      return { html: "", status: 404, url: value };
    }
  });
  const parsed = source.parse(raw, fixture.company);
  assert.equal(parsed.length, 4);
  const normalized = parsed.map((posting) => source.normalize(posting, fixture.company));
  const byId = Object.fromEntries(normalized.map((posting) => [posting.source_job_id, posting]));

  assert.equal(byId["ATJ2001"].country, fixture.expected["ATJ2001"].country);
  assert.equal(byId["ATJ2001"].city, fixture.expected["ATJ2001"].city);
  assert.equal(byId["ATJ2001"].posting_date, fixture.expected["ATJ2001"].posting_date);
  assert.equal(byId["ATJ2001"].source_evidence.location_source, fixture.expected["ATJ2001"].location_source);
  assert.equal(evaluatePublicPosting(byId["ATJ2001"], { parserVersion: source.parserVersion }).status, "accepted");

  assert.equal(byId["ATJ2002"].remote_type, fixture.expected["ATJ2002"].remote_type);
  assert.equal(byId["ATJ2002"].posting_date, fixture.expected["ATJ2002"].posting_date);
  assert.equal(byId["ATJ2002"].source_evidence.remote_source, fixture.expected["ATJ2002"].remote_source);
  assert.equal(evaluatePublicPosting(byId["ATJ2002"], { parserVersion: source.parserVersion }).status, "accepted");

  assert.equal(byId["ATJ2003"].country, fixture.expected["ATJ2003"].country);
  assert.equal(byId["ATJ2003"].city, fixture.expected["ATJ2003"].city);
  assert.equal(byId["ATJ2003"].remote_type, fixture.expected["ATJ2003"].remote_type);
  assert.equal(byId["ATJ2003"].source_evidence.remote_source, fixture.expected["ATJ2003"].remote_source);
  assert.equal(evaluatePublicPosting(byId["ATJ2003"], { parserVersion: source.parserVersion }).status, "accepted");

  assert.ok(byId["ATJ2004"].source_failure_reasons.includes(fixture.expected["ATJ2004"].reason));
  assert.equal(evaluatePublicPosting(byId["ATJ2004"], { parserVersion: source.parserVersion }).status, "quarantined");
});

test("applytojob source module parses generic card links with labeled fields", () => {
  const source = getSourceModule("applytojob");
  const company = readJson(path.join(__dirname, "applytojob", "fixtures", "company.json"));
  const parsed = source.parse({
    html: `
      <section class="jobs">
        <article class="job-card">
          <a class="job-title" href="/apply/ATJ3001/Onsite-Operations-Lead">Onsite Operations Lead</a>
          <div><span>Location:</span><span>Austin, TX, United States</span></div>
          <div><span>Work Type:</span><span>On-site</span></div>
          <div><span>Date Posted:</span><span>2026-05-12</span></div>
        </article>
      </section>
    `,
    __listUrl: company.url_string
  }, company);
  assert.equal(parsed.length, 1);
  const normalized = source.normalize(parsed[0], company);
  assert.equal(normalized.source_job_id, "ATJ3001");
  assert.equal(normalized.position_name, "Onsite Operations Lead");
  assert.equal(normalized.country, "United States");
  assert.equal(normalized.city, "Austin");
  assert.equal(normalized.remote_type, "onsite");
  assert.equal(normalized.posting_date, "2026-05-12");
  assert.equal(normalized.source_evidence.route_kind, "applytojob_generic_card_html");
  assert.equal(source.validatePublic(normalized).status, "accepted");
});

test("breezy source module enriches list rows from JSON-LD and labeled detail pages", async () => {
  const source = getSourceModule("breezy");
  const sourceDir = path.join(__dirname, "breezy");
  const fixture = readJson(path.join(sourceDir, "fixtures", "route-detection.json"));

  const raw = await source.fetchList(fixture.company, {
    fetcher: async (url) => {
      const value = String(url || "");
      if (value === fixture.company.url_string) return { html: fixture.list_html, status: 200, url: value };
      const jobId = new URL(value).pathname.split("/").filter(Boolean)[1];
      if (fixture.details[jobId]) return { html: fixture.details[jobId], status: 200, url: value };
      return { html: "", status: 404, url: value };
    }
  });
  const parsed = source.parse(raw, fixture.company);
  assert.equal(parsed.length, 4);
  const normalized = parsed.map((posting) => source.normalize(posting, fixture.company));
  const byId = Object.fromEntries(normalized.map((posting) => [posting.source_job_id, posting]));

  assert.equal(byId["BRZ2001-remote-support"].country, fixture.expected["BRZ2001-remote-support"].country);
  assert.equal(byId["BRZ2001-remote-support"].remote_type, fixture.expected["BRZ2001-remote-support"].remote_type);
  assert.equal(byId["BRZ2001-remote-support"].posting_date, fixture.expected["BRZ2001-remote-support"].posting_date);
  assert.equal(byId["BRZ2001-remote-support"].source_evidence.remote_source, fixture.expected["BRZ2001-remote-support"].remote_source);
  assert.equal(evaluatePublicPosting(byId["BRZ2001-remote-support"], { parserVersion: source.parserVersion }).status, "accepted");

  assert.equal(byId["BRZ2002-hybrid-product-manager"].country, fixture.expected["BRZ2002-hybrid-product-manager"].country);
  assert.equal(byId["BRZ2002-hybrid-product-manager"].city, fixture.expected["BRZ2002-hybrid-product-manager"].city);
  assert.equal(byId["BRZ2002-hybrid-product-manager"].remote_type, fixture.expected["BRZ2002-hybrid-product-manager"].remote_type);
  assert.equal(byId["BRZ2002-hybrid-product-manager"].source_evidence.remote_source, fixture.expected["BRZ2002-hybrid-product-manager"].remote_source);
  assert.equal(evaluatePublicPosting(byId["BRZ2002-hybrid-product-manager"], { parserVersion: source.parserVersion }).status, "accepted");

  assert.equal(byId["BRZ2003-onsite-engineer"].country, fixture.expected["BRZ2003-onsite-engineer"].country);
  assert.equal(byId["BRZ2003-onsite-engineer"].city, fixture.expected["BRZ2003-onsite-engineer"].city);
  assert.equal(byId["BRZ2003-onsite-engineer"].remote_type, fixture.expected["BRZ2003-onsite-engineer"].remote_type);
  assert.equal(byId["BRZ2003-onsite-engineer"].source_evidence.remote_source, fixture.expected["BRZ2003-onsite-engineer"].remote_source);
  assert.equal(evaluatePublicPosting(byId["BRZ2003-onsite-engineer"], { parserVersion: source.parserVersion }).status, "accepted");

  assert.ok(byId["BRZ2004-ambiguous-role"].source_failure_reasons.includes(fixture.expected["BRZ2004-ambiguous-role"].reason));
  assert.equal(evaluatePublicPosting(byId["BRZ2004-ambiguous-role"], { parserVersion: source.parserVersion }).status, "quarantined");
});

test("breezy source module parses card titles outside heading tags", () => {
  const source = getSourceModule("breezy");
  const company = readJson(path.join(__dirname, "breezy", "fixtures", "company.json"));
  const parsed = source.parse({
    html: `
      <div class="position-card">
        <a href="/p/BRZ3001-customer-success-manager" title="Customer Success Manager">
          <span class="position-title">Customer Success Manager</span>
          <ul class="meta">
            <li class="location"><span>Toronto, Canada</span></li>
            <li class="posted"><span>2026-05-13</span></li>
            <li class="type"><span>%LABEL_POSITION_TYPE_ON_SITE%</span></li>
          </ul>
        </a>
      </div>
    `,
    __listUrl: company.url_string
  }, company);
  assert.equal(parsed.length, 1);
  const normalized = source.normalize(parsed[0], company);
  assert.equal(normalized.source_job_id, "BRZ3001-customer-success-manager");
  assert.equal(normalized.position_name, "Customer Success Manager");
  assert.equal(normalized.country, "Canada");
  assert.equal(normalized.city, "Toronto");
  assert.equal(normalized.remote_type, "onsite");
  assert.equal(normalized.posting_date, "2026-05-13");
  assert.equal(source.validatePublic(normalized).status, "accepted");
});
