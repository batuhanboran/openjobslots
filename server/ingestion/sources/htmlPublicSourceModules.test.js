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

test("applytojob source fetch spends limited detail budget on rows missing geo evidence", async () => {
  const source = getSourceModule("applytojob");
  const company = {
    company_name: "Fixture ApplyToJob",
    ATS_name: "applytojob",
    url_string: "https://fixture.applytojob.com/apply"
  };
  const previousLimit = process.env.OPENJOBSLOTS_APPLYTOJOB_DETAIL_FETCH_LIMIT_PER_COMPANY;
  process.env.OPENJOBSLOTS_APPLYTOJOB_DETAIL_FETCH_LIMIT_PER_COMPANY = "1";
  const fetchedUrls = [];
  try {
    const raw = await source.fetchList(company, {
      fetcher: async (url) => {
        const value = String(url || "");
        fetchedUrls.push(value);
        if (value.endsWith("/apply")) {
          return {
            status: 200,
            url: value,
            html: `
              <ul>
                <li class="list-group-item">
                  <h3 class="list-group-item-heading"><a href="/apply/ATJ-CLEAN/Operations-Lead">Operations Lead</a></h3>
                  <i class="fa fa-map-marker"></i>Austin, TX, United States
                  <i class="fa fa-calendar"></i>2026-05-12
                </li>
                <li class="list-group-item">
                  <h3 class="list-group-item-heading"><a href="/apply/ATJ-NEEDS/Training-Manager">Training Manager</a></h3>
                </li>
              </ul>
            `
          };
        }
        if (value.includes("/ATJ-NEEDS/")) {
          return {
            status: 200,
            url: value,
            html: `
              <script type="application/ld+json">
                {
                  "@context": "https://schema.org",
                  "@type": "JobPosting",
                  "title": "Training Manager",
                  "datePosted": "2026-05-13",
                  "jobLocation": {
                    "@type": "Place",
                    "address": {
                      "@type": "PostalAddress",
                      "addressLocality": "Iloilo City",
                      "addressRegion": "Iloilo",
                      "addressCountry": "PH"
                    }
                  }
                }
              </script>
            `
          };
        }
        return { status: 200, url: value, html: "<html></html>" };
      }
    });
    const parsed = source.parse(raw, company);
    const normalized = parsed.map((posting) => source.normalize(posting, company));
    const byId = Object.fromEntries(normalized.map((posting) => [posting.source_job_id, posting]));

    assert.ok(fetchedUrls.some((url) => url.includes("/ATJ-NEEDS/")));
    assert.equal(byId["ATJ-NEEDS"].country, "Philippines");
    assert.equal(byId["ATJ-NEEDS"].city, "Iloilo City");
    assert.equal(evaluatePublicPosting(byId["ATJ-NEEDS"], { parserVersion: source.parserVersion }).status, "accepted");
  } finally {
    if (previousLimit === undefined) {
      delete process.env.OPENJOBSLOTS_APPLYTOJOB_DETAIL_FETCH_LIMIT_PER_COMPANY;
    } else {
      process.env.OPENJOBSLOTS_APPLYTOJOB_DETAIL_FETCH_LIMIT_PER_COMPANY = previousLimit;
    }
  }
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

test("applytojob source module normalizes source-provided country tokens", () => {
  const source = getSourceModule("applytojob");
  const company = readJson(path.join(__dirname, "applytojob", "fixtures", "company.json"));
  const parsed = source.parse({
    html: `
      <section class="jobs">
        <article class="job-card">
          <a class="job-title" href="/apply/ATJ4001/Store-Lead">Store Lead</a>
          <div><span>Location:</span><span>Nassau, Bahamas</span></div>
        </article>
        <article class="job-card">
          <a class="job-title" href="/apply/ATJ4002/Project-Engineer">Project Engineer</a>
          <div><span>Location:</span><span>Juncos, PR, Puerto Rico</span></div>
        </article>
        <article class="job-card">
          <a class="job-title" href="/apply/ATJ4003/Beach-Attendant">Beach Attendant</a>
          <div><span>Location:</span><span>Aruba</span></div>
        </article>
        <article class="job-card">
          <a class="job-title" href="/apply/ATJ4004/Salesforce-Consultant">Salesforce Consultant</a>
          <div><span>Location:</span><span>Casablanca, Morocco</span></div>
        </article>
      </section>
    `,
    __listUrl: company.url_string
  }, company);
  assert.equal(parsed.length, 4);
  const normalized = Object.fromEntries(
    parsed.map((posting) => {
      const row = source.normalize(posting, company);
      return [row.source_job_id, row];
    })
  );

  assert.equal(normalized.ATJ4001.country, "Bahamas");
  assert.equal(normalized.ATJ4001.region, "North America");
  assert.equal(normalized.ATJ4001.city, "Nassau");
  assert.equal(normalized.ATJ4001.source_evidence.location_rule_name, "applytojob_country_token_hint");

  assert.equal(normalized.ATJ4002.country, "Puerto Rico");
  assert.equal(normalized.ATJ4002.region, "North America");
  assert.equal(normalized.ATJ4002.city, "Juncos");
  assert.equal(normalized.ATJ4002.source_evidence.location_rule_name, "applytojob_country_token_hint");

  assert.equal(normalized.ATJ4003.country, "Aruba");
  assert.equal(normalized.ATJ4003.region, "North America");
  assert.equal(normalized.ATJ4003.city, "");
  assert.equal(normalized.ATJ4003.source_evidence.location_rule_name, "applytojob_country_token_hint");

  assert.equal(normalized.ATJ4004.country, "Morocco");
  assert.equal(normalized.ATJ4004.region, "EMEA");
  assert.equal(normalized.ATJ4004.city, "Casablanca");
  assert.equal(normalized.ATJ4004.source_evidence.location_rule_name, "applytojob_country_token_hint");
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

test("breezy source module quarantines narrative detail text captured as location", () => {
  const source = getSourceModule("breezy");
  const company = readJson(path.join(__dirname, "breezy", "fixtures", "company.json"));
  const detailUrl = "https://fixture.breezy.hr/p/BRZ4001-sales-specialist";
  const narrativeLocation = "client-specific needs while ensuring compliance with internal and external regulations.";
  const parsed = source.parse({
    html: `
      <a href="/p/BRZ4001-sales-specialist">
        <h2>Sales Specialist - Cash Management</h2>
      </a>
    `,
    __listUrl: company.url_string,
    __detailHtmlByUrl: {
      [detailUrl]: `
        <html>
          <body>
            <dl>
              <dt>Location</dt>
              <dd>${narrativeLocation}</dd>
            </dl>
          </body>
        </html>
      `
    }
  }, company);

  assert.equal(parsed.length, 1);
  const normalized = source.normalize(parsed[0], company);
  assert.notEqual(normalized.city, narrativeLocation);
  assert.ok(normalized.source_failure_reasons.includes("detail_no_structured_location"));
  const gate = source.validatePublic(normalized);
  assert.equal(gate.status, "quarantined");
  assert.ok(gate.reason_codes.includes("no_geo_no_remote"));
});

test("breezy source module treats worldwide position labels as explicit remote evidence", () => {
  const source = getSourceModule("breezy");
  const company = readJson(path.join(__dirname, "breezy", "fixtures", "company.json"));
  const parsed = source.parse({
    html: `
      <h2 class="group-header"><i class="fa fa-map-marker"></i><span>Worldwide</span></h2>
      <ul class="positions location">
        <li class="position transition">
          <ul class="position-wrap">
            <li class="position-details">
              <a href="/p/BRZ5001-link-building-specialist" title="Apply">
                <h2>Link Building Specialist</h2>
                <ul class="meta">
                  <li class="location">
                    <i class="fa fa-wifi"></i>
                    <span class="polygot">%LABEL_POSITION_TYPE_WORLDWIDE%</span>
                  </li>
                  <li class="type"><span class="polygot">%LABEL_POSITION_TYPE_OTHER%</span></li>
                </ul>
              </a>
            </li>
          </ul>
        </li>
      </ul>
    `,
    __listUrl: company.url_string
  }, company);

  assert.equal(parsed.length, 1);
  const normalized = source.normalize(parsed[0], company);
  assert.equal(normalized.source_job_id, "BRZ5001-link-building-specialist");
  assert.equal(normalized.location_text, "Worldwide");
  assert.equal(normalized.city || "", "");
  assert.equal(normalized.country || "", "");
  assert.equal(normalized.remote_type, "remote");
  assert.equal(normalized.source_evidence.remote_source, "labeled_html");
  assert.equal(normalized.source_evidence.remote_path, "Breezy worldwide position label");
  assert.equal(source.validatePublic(normalized).status, "accepted");
});

test("breezy source module does not publish state codes or placeholders as cities", () => {
  const source = getSourceModule("breezy");
  const company = readJson(path.join(__dirname, "breezy", "fixtures", "company.json"));
  const stateOnlyUrl = "https://fixture.breezy.hr/p/BRZ6001-state-only-locality";
  const placeholderUrl = "https://fixture.breezy.hr/p/BRZ6002-placeholder-locality";
  const parsed = source.parse({
    html: `
      <a href="/p/BRZ6001-state-only-locality"><h2>State Only Locality</h2></a>
      <a href="/p/BRZ6002-placeholder-locality"><h2>Placeholder Locality</h2></a>
    `,
    __listUrl: company.url_string,
    __detailHtmlByUrl: {
      [stateOnlyUrl]: `
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "JobPosting",
            "title": "State Only Locality",
            "datePosted": "2026-05-15",
            "jobLocation": {
              "@type": "Place",
              "address": {
                "@type": "PostalAddress",
                "addressLocality": "NC",
                "addressCountry": "US"
              }
            }
          }
        </script>
      `,
      [placeholderUrl]: `
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "JobPosting",
            "title": "Placeholder Locality",
            "datePosted": "2026-05-15",
            "jobLocation": {
              "@type": "Place",
              "address": {
                "@type": "PostalAddress",
                "addressLocality": "None",
                "addressCountry": "US"
              }
            }
          }
        </script>
      `
    }
  }, company);

  const normalized = Object.fromEntries(parsed.map((posting) => {
    const row = source.normalize(posting, company);
    return [row.source_job_id, row];
  }));

  assert.equal(normalized["BRZ6001-state-only-locality"].country, "United States");
  assert.equal(normalized["BRZ6001-state-only-locality"].city, "");
  assert.equal(normalized["BRZ6001-state-only-locality"].source_evidence.city_source || "", "");

  assert.equal(normalized["BRZ6002-placeholder-locality"].country, "United States");
  assert.equal(normalized["BRZ6002-placeholder-locality"].city, "");
  assert.equal(normalized["BRZ6002-placeholder-locality"].source_evidence.city_source || "", "");
});

test("hrmdirect source module enriches title-only rows from deterministic detail pages", async () => {
  const source = getSourceModule("hrmdirect");
  const sourceDir = path.join(__dirname, "hrmdirect");
  const fixture = readJson(path.join(sourceDir, "fixtures", "route-detection.json"));

  const raw = await source.fetchList(fixture.company, {
    fetcher: async (url) => {
      const value = String(url || "");
      if (value === fixture.company.url_string) return { html: fixture.list_html, status: 200, url: value };
      const parsed = new URL(value);
      const req = parsed.searchParams.get("req");
      if (fixture.details[req]) return { html: fixture.details[req], status: 200, url: value };
      return { html: "", status: 404, url: value };
    }
  });
  const parsed = source.parse(raw, fixture.company);
  assert.equal(parsed.length, 2);
  const normalized = parsed.map((posting) => source.normalize(posting, fixture.company));
  const byId = Object.fromEntries(normalized.map((posting) => [posting.source_job_id, posting]));

  assert.equal(byId.HRM3001.location_text, "Shallotte, NC");
  assert.equal(byId.HRM3001.country, fixture.expected.HRM3001.country);
  assert.equal(byId.HRM3001.city, fixture.expected.HRM3001.city);
  assert.equal(byId.HRM3001.department, fixture.expected.HRM3001.department);
  assert.equal(byId.HRM3001.source_evidence.location_source, fixture.expected.HRM3001.location_source);
  assert.equal(evaluatePublicPosting(byId.HRM3001, { parserVersion: source.parserVersion }).status, "accepted");

  assert.ok(byId.HRM3002.source_failure_reasons.includes(fixture.expected.HRM3002.reason));
  assert.equal(evaluatePublicPosting(byId.HRM3002, { parserVersion: source.parserVersion }).status, "quarantined");
});

test("hrmdirect source module accepts labeled detail workplace remote evidence", async () => {
  const source = getSourceModule("hrmdirect");
  const company = {
    company_name: "Fixture HRMDirect Workplace",
    ATS_name: "hrmdirect",
    url_string: "https://workplace.hrmdirect.com/employment/job-openings.php"
  };
  const listUrl = "https://workplace.hrmdirect.com/employment/job-openings.php?search=true";
  const detailUrl = "https://workplace.hrmdirect.com/employment/job-opening.php?req=HRM7001";

  const raw = await source.fetchList(company, {
    fetcher: async (url) => {
      if (url === listUrl) {
        return {
          html: `<table>
            <tr class="reqitem" data-req-id="HRM7001">
              <td class="departments reqitem ReqRowClick">Field Adjusters</td>
              <td class="posTitle reqitem ReqRowClick"><a href="job-opening.php?req=HRM7001&req_loc=1323691">Field Adjuster - Panhandle</a></td>
              <td class="cities reqitem ReqRowClick"></td>
              <td class="state reqitem ReqRowClick"></td>
            </tr>
          </table>`,
          status: 200,
          url
        };
      }
      if (url === detailUrl) {
        return {
          html: `<table class="viewFields">
            <tr><td class="viewFieldName"><b>Department:</b></td><td class="viewFieldValue">Field Adjusters</td></tr>
            <tr><td class="viewFieldName"><b>Location:</b></td><td class="viewFieldValue"></td></tr>
            <tr><td class="viewFieldName"><b>Workplace Type:</b></td><td class="viewFieldValue">Remote</td></tr>
          </table>`,
          status: 200,
          url
        };
      }
      return { html: "", status: 404, url };
    }
  });

  const [posting] = source.parse(raw, company);
  const normalized = source.normalize(posting, company);

  assert.equal(normalized.source_job_id, "HRM7001");
  assert.equal(normalized.location_text || "", "");
  assert.equal(normalized.remote_type, "remote");
  assert.equal(normalized.source_evidence.remote_source, "labeled_detail_html");
  assert.equal(normalized.source_evidence.remote_path, "table.viewFields Workplace Type");
  assert.deepEqual(normalized.source_failure_reasons || [], []);
  assert.equal(evaluatePublicPosting(normalized, { parserVersion: source.parserVersion }).status, "accepted");
});

test("hrmdirect source module accepts exact LI remote detail tags as remote evidence", async () => {
  const source = getSourceModule("hrmdirect");
  const sourceDir = path.join(__dirname, "hrmdirect");
  const fixture = readJson(path.join(sourceDir, "fixtures", "li-remote-tag.json"));

  const raw = await source.fetchList(fixture.company, {
    fetcher: async (url) => {
      if (url === fixture.search_list_url) return { html: fixture.list_html, status: 200, url };
      if (url === fixture.rss_url) return { html: "", status: 404, url };
      if (url === fixture.detail_url) return { html: fixture.detail_html, status: 200, url };
      return { html: "", status: 404, url };
    }
  });
  const [posting] = source.parse(raw, fixture.company);
  const normalized = source.normalize(posting, fixture.company);

  assert.equal(normalized.source_job_id, fixture.expected.source_job_id);
  assert.equal(normalized.location, null);
  assert.equal(normalized.remote_type, fixture.expected.remote_type);
  assert.equal(normalized.source_evidence.remote_source, fixture.expected.remote_source);
  assert.equal(normalized.source_evidence.remote_path, fixture.expected.remote_path);
  assert.equal(normalized.source_evidence.remote_rule_name, fixture.expected.remote_rule_name);
  assert.deepEqual(normalized.source_failure_reasons || [], []);
  assert.equal(evaluatePublicPosting(normalized, { parserVersion: source.parserVersion }).status, "accepted");
});

test("hrmdirect source module accepts labeled detail body location remote evidence", async () => {
  const source = getSourceModule("hrmdirect");
  const sourceDir = path.join(__dirname, "hrmdirect");
  const fixture = readJson(path.join(sourceDir, "fixtures", "body-location-remote.json"));

  const raw = await source.fetchList(fixture.company, {
    fetcher: async (url) => {
      if (url === fixture.search_list_url) return { html: fixture.list_html, status: 200, url };
      if (url === fixture.rss_url) return { html: "", status: 404, url };
      if (url === fixture.detail_url) return { html: fixture.detail_html, status: 200, url };
      return { html: "", status: 404, url };
    }
  });
  const [posting] = source.parse(raw, fixture.company);
  const normalized = source.normalize(posting, fixture.company);

  assert.equal(normalized.source_job_id, fixture.expected.source_job_id);
  assert.equal(normalized.location, null);
  assert.equal(normalized.remote_type, fixture.expected.remote_type);
  assert.equal(normalized.source_evidence.remote_source, fixture.expected.remote_source);
  assert.equal(normalized.source_evidence.remote_path, fixture.expected.remote_path);
  assert.equal(normalized.source_evidence.remote_rule_name, fixture.expected.remote_rule_name);
  assert.deepEqual(normalized.source_failure_reasons || [], []);
  assert.equal(evaluatePublicPosting(normalized, { parserVersion: source.parserVersion }).status, "accepted");
});

test("hrmdirect source module accepts exact detail body work arrangement remote evidence", async () => {
  const source = getSourceModule("hrmdirect");
  const sourceDir = path.join(__dirname, "hrmdirect");
  const fixture = readJson(path.join(sourceDir, "fixtures", "body-work-arrangement-remote.json"));

  const raw = await source.fetchList(fixture.company, {
    fetcher: async (url) => {
      if (url === fixture.search_list_url) return { html: fixture.list_html, status: 200, url };
      if (url === fixture.rss_url) return { html: "", status: 404, url };
      for (const [sourceJobId, detailUrl] of Object.entries(fixture.detail_urls)) {
        if (url === detailUrl) return { html: fixture.detail_html[sourceJobId], status: 200, url };
      }
      return { html: "", status: 404, url };
    }
  });
  const parsed = source.parse(raw, fixture.company);
  const normalized = Object.fromEntries(parsed.map((posting) => {
    const row = source.normalize(posting, fixture.company);
    return [row.source_job_id, row];
  }));

  for (const [sourceJobId, expected] of Object.entries(fixture.expected)) {
    const row = normalized[sourceJobId];
    assert.ok(row, `expected row ${sourceJobId}`);
    assert.equal(row.source_job_id, expected.source_job_id);
    assert.equal(row.location_text, expected.location_text);
    assert.equal(row.city || "", expected.city);
    assert.equal(row.country || "", expected.country);
    assert.equal(row.remote_type, expected.remote_type);
    assert.equal(row.source_evidence.remote_source, expected.remote_source);
    assert.equal(row.source_evidence.remote_path, expected.remote_path);
    assert.equal(row.source_evidence.remote_rule_name, expected.remote_rule_name);
    assert.deepEqual(row.source_failure_reasons || [], []);
    assert.equal(evaluatePublicPosting(row, { parserVersion: source.parserVersion }).status, "accepted");
  }
});

test("hrmdirect source module accepts labeled detail body address location evidence", async () => {
  const source = getSourceModule("hrmdirect");
  const sourceDir = path.join(__dirname, "hrmdirect");
  const fixture = readJson(path.join(sourceDir, "fixtures", "body-location-address.json"));

  const raw = await source.fetchList(fixture.company, {
    fetcher: async (url) => {
      if (url === fixture.search_list_url) return { html: fixture.list_html, status: 200, url };
      if (url === fixture.rss_url) return { html: "", status: 404, url };
      if (url === fixture.detail_url) return { html: fixture.detail_html, status: 200, url };
      return { html: "", status: 404, url };
    }
  });
  const [posting] = source.parse(raw, fixture.company);
  const normalized = source.normalize(posting, fixture.company);

  assert.equal(normalized.source_job_id, fixture.expected.source_job_id);
  assert.equal(normalized.location, fixture.expected.location);
  assert.equal(normalized.city, fixture.expected.city);
  assert.equal(normalized.country, fixture.expected.country);
  assert.equal(normalized.source_evidence.location_source, fixture.expected.location_source);
  assert.equal(normalized.source_evidence.location_path, fixture.expected.location_path);
  assert.equal(normalized.source_evidence.location_rule_name, fixture.expected.location_rule_name);
  assert.deepEqual(normalized.source_failure_reasons || [], []);
  assert.equal(evaluatePublicPosting(normalized, { parserVersion: source.parserVersion }).status, "accepted");
});

test("hrmdirect source module quarantines body location labels without strict address evidence", async () => {
  const source = getSourceModule("hrmdirect");
  const sourceDir = path.join(__dirname, "hrmdirect");
  const fixture = readJson(path.join(sourceDir, "fixtures", "body-location-address-invalid.json"));

  const raw = await source.fetchList(fixture.company, {
    fetcher: async (url) => {
      if (url === fixture.search_list_url) return { html: fixture.list_html, status: 200, url };
      if (url === fixture.rss_url) return { html: "", status: 404, url };
      if (url === fixture.detail_url) return { html: fixture.detail_html, status: 200, url };
      return { html: "", status: 404, url };
    }
  });
  const [posting] = source.parse(raw, fixture.company);
  const normalized = source.normalize(posting, fixture.company);

  assert.equal(normalized.source_job_id, fixture.expected.source_job_id);
  assert.equal(normalized.location, null);
  assert.equal(normalized.source_evidence.location_source || "", "");
  assert.ok(normalized.source_failure_reasons.includes(fixture.expected.reason));
  assert.equal(evaluatePublicPosting(normalized, { parserVersion: source.parserVersion }).status, "quarantined");
});

test("hrmdirect source module treats list city remote scopes as remote evidence without fake city", async () => {
  const source = getSourceModule("hrmdirect");
  const sourceDir = path.join(__dirname, "hrmdirect");
  const fixture = readJson(path.join(sourceDir, "fixtures", "list-remote-location.json"));

  const raw = await source.fetchList(fixture.company, {
    fetcher: async (url) => {
      if (url === fixture.search_list_url) return { html: fixture.list_html, status: 200, url };
      if (url === fixture.rss_url) return { html: "", status: 404, url };
      return { html: "", status: 404, url };
    }
  });
  const parsed = source.parse(raw, fixture.company);
  const normalized = Object.fromEntries(parsed.map((posting) => {
    const row = source.normalize(posting, fixture.company);
    return [row.source_job_id, row];
  }));

  for (const [sourceJobId, expected] of Object.entries(fixture.expected)) {
    const row = normalized[sourceJobId];
    assert.ok(row, `expected row ${sourceJobId}`);
    assert.equal(row.location, expected.location);
    assert.equal(row.city, expected.city);
    assert.equal(row.country, expected.country);
    assert.equal(row.remote_type, expected.remote_type);
    assert.equal(row.source_evidence.location_path, expected.location_path);
    assert.equal(row.source_evidence.location_rule_name, expected.location_rule_name);
    assert.equal(row.source_evidence.remote_source, expected.remote_source);
    assert.equal(row.source_evidence.remote_path, expected.remote_path);
    assert.equal(row.source_evidence.remote_rule_name, expected.remote_rule_name);
    assert.deepEqual(row.source_failure_reasons || [], []);
    assert.equal(evaluatePublicPosting(row, { parserVersion: source.parserVersion }).status, "accepted");
  }
});

test("hrmdirect source module treats detail Location remote label as remote evidence", async () => {
  const source = getSourceModule("hrmdirect");
  const sourceDir = path.join(__dirname, "hrmdirect");
  const fixture = readJson(path.join(sourceDir, "fixtures", "detail-location-remote.json"));

  const raw = await source.fetchList(fixture.company, {
    fetcher: async (url) => {
      if (url === fixture.search_list_url) return { html: fixture.list_html, status: 200, url };
      if (url === fixture.rss_url) return { html: "", status: 404, url };
      if (url === fixture.detail_url) return { html: fixture.detail_html, status: 200, url };
      return { html: "", status: 404, url };
    }
  });
  const [posting] = source.parse(raw, fixture.company);
  const normalized = source.normalize(posting, fixture.company);

  assert.equal(normalized.source_job_id, fixture.expected.source_job_id);
  assert.equal(normalized.location, fixture.expected.location);
  assert.equal(normalized.city, fixture.expected.city);
  assert.equal(normalized.country, fixture.expected.country);
  assert.equal(normalized.remote_type, fixture.expected.remote_type);
  assert.equal(normalized.source_evidence.location_source, fixture.expected.location_source);
  assert.equal(normalized.source_evidence.location_path, fixture.expected.location_path);
  assert.equal(normalized.source_evidence.remote_source, fixture.expected.remote_source);
  assert.equal(normalized.source_evidence.remote_path, fixture.expected.remote_path);
  assert.equal(normalized.source_evidence.remote_rule_name, fixture.expected.remote_rule_name);
  assert.deepEqual(normalized.source_failure_reasons || [], []);
  assert.equal(evaluatePublicPosting(normalized, { parserVersion: source.parserVersion }).status, "accepted");
});

test("hrmdirect source module strips detail remote prefix while preserving scope location", async () => {
  const source = getSourceModule("hrmdirect");
  const sourceDir = path.join(__dirname, "hrmdirect");
  const fixture = readJson(path.join(sourceDir, "fixtures", "detail-location-remote-scope.json"));

  const raw = await source.fetchList(fixture.company, {
    fetcher: async (url) => {
      if (url === fixture.search_list_url) return { html: fixture.list_html, status: 200, url };
      if (url === fixture.rss_url) return { html: "", status: 404, url };
      if (url === fixture.detail_url) return { html: fixture.detail_html, status: 200, url };
      return { html: "", status: 404, url };
    }
  });
  const [posting] = source.parse(raw, fixture.company);
  const normalized = source.normalize(posting, fixture.company);

  assert.equal(normalized.source_job_id, fixture.expected.source_job_id);
  assert.equal(normalized.location_text, fixture.expected.location_text);
  assert.equal(normalized.city || "", fixture.expected.city);
  assert.equal(normalized.country, fixture.expected.country);
  assert.equal(normalized.remote_type, fixture.expected.remote_type);
  assert.equal(normalized.source_evidence.location_source, fixture.expected.location_source);
  assert.equal(normalized.source_evidence.location_path, fixture.expected.location_path);
  assert.equal(normalized.source_evidence.location_rule_name, fixture.expected.location_rule_name);
  assert.equal(normalized.source_evidence.remote_source, fixture.expected.remote_source);
  assert.equal(normalized.source_evidence.remote_path, fixture.expected.remote_path);
  assert.equal(normalized.source_evidence.remote_rule_name, fixture.expected.remote_rule_name);
  assert.deepEqual(normalized.source_failure_reasons || [], []);
  assert.equal(evaluatePublicPosting(normalized, { parserVersion: source.parserVersion }).status, "accepted");
});

test("hrmdirect source module parses grouped div lists with detail location evidence", async () => {
  const source = getSourceModule("hrmdirect");
  const sourceDir = path.join(__dirname, "hrmdirect");
  const fixture = readJson(path.join(sourceDir, "fixtures", "grouped-div-list.json"));
  const requestedUrls = [];

  const raw = await source.fetchList(fixture.company, {
    fetcher: async (url) => {
      requestedUrls.push(String(url));
      if (url === fixture.search_list_url) return { html: fixture.list_html, status: 200, url };
      if (url === fixture.rss_url) return { html: "", status: 404, url };
      for (const [sourceJobId, detailUrl] of Object.entries(fixture.detail_urls)) {
        if (url === detailUrl) return { html: fixture.detail_html[sourceJobId], status: 200, url };
      }
      return { html: "", status: 404, url };
    }
  });
  const parsed = source.parse(raw, fixture.company);
  const normalized = Object.fromEntries(parsed.map((posting) => {
    const row = source.normalize(posting, fixture.company);
    return [row.source_job_id, row];
  }));

  assert.equal(parsed.length, Object.keys(fixture.expected).length);
  for (const detailUrl of Object.values(fixture.detail_urls)) {
    assert.ok(requestedUrls.includes(detailUrl), `expected detail fetch ${detailUrl}`);
  }
  for (const [sourceJobId, expected] of Object.entries(fixture.expected)) {
    const row = normalized[sourceJobId];
    assert.ok(row, `expected row ${sourceJobId}`);
    assert.equal(row.source_job_id, expected.source_job_id);
    assert.equal(row.location_text, expected.location_text);
    assert.equal(row.city, expected.city);
    assert.equal(row.country, expected.country);
    assert.equal(row.department, expected.department);
    assert.equal(row.remote_type, expected.remote_type);
    assert.equal(row.source_evidence.source_job_id_path, expected.source_job_id_path);
    assert.equal(row.source_evidence.location_source, expected.location_source);
    assert.equal(row.source_evidence.location_path, expected.location_path);
    assert.equal(row.source_evidence.location_rule_name, expected.location_rule_name);
    assert.deepEqual(row.source_failure_reasons || [], []);
    assert.equal(evaluatePublicPosting(row, { parserVersion: source.parserVersion }).status, "accepted");
  }
});

test("hrmdirect source module does not publish ambiguous multiple-city labels as city", async () => {
  const source = getSourceModule("hrmdirect");
  const sourceDir = path.join(__dirname, "hrmdirect");
  const fixture = readJson(path.join(sourceDir, "fixtures", "detail-location-multiple-cities.json"));

  const raw = await source.fetchList(fixture.company, {
    fetcher: async (url) => {
      if (url === fixture.search_list_url) return { html: fixture.list_html, status: 200, url };
      if (url === fixture.rss_url) return { html: "", status: 404, url };
      if (url === fixture.detail_url) return { html: fixture.detail_html, status: 200, url };
      return { html: "", status: 404, url };
    }
  });
  const [posting] = source.parse(raw, fixture.company);
  const normalized = source.normalize(posting, fixture.company);
  const gate = evaluatePublicPosting(normalized, { parserVersion: source.parserVersion });

  assert.equal(normalized.source_job_id, fixture.expected.source_job_id);
  assert.equal(normalized.location_text, fixture.expected.location_text);
  assert.equal(normalized.city || "", fixture.expected.city);
  assert.equal(normalized.country, fixture.expected.country);
  assert.equal(normalized.remote_type, fixture.expected.remote_type);
  assert.equal(normalized.source_evidence.location_source, fixture.expected.location_source);
  assert.equal(normalized.source_evidence.location_path, fixture.expected.location_path);
  assert.ok(normalized.source_failure_reasons.includes(fixture.expected.source_failure_reason));
  assert.equal(gate.status, "quarantined");
  assert.ok(gate.reason_codes.includes(fixture.expected.source_failure_reason));
});

test("hrmdirect source module does not publish detail state abbreviation as city", async () => {
  const source = getSourceModule("hrmdirect");
  const sourceDir = path.join(__dirname, "hrmdirect");
  const fixture = readJson(path.join(sourceDir, "fixtures", "detail-location-state-abbreviation.json"));

  const raw = await source.fetchList(fixture.company, {
    fetcher: async (url) => {
      if (url === fixture.search_list_url) return { html: fixture.list_html, status: 200, url };
      if (url === fixture.rss_url) return { html: "", status: 404, url };
      if (url === fixture.detail_url) return { html: fixture.detail_html, status: 200, url };
      return { html: "", status: 404, url };
    }
  });
  const [posting] = source.parse(raw, fixture.company);
  const normalized = source.normalize(posting, fixture.company);

  assert.equal(normalized.source_job_id, fixture.expected.source_job_id);
  assert.equal(normalized.location_text, fixture.expected.location_text);
  assert.equal(normalized.city || "", fixture.expected.city);
  assert.equal(normalized.country, fixture.expected.country);
  assert.equal(normalized.remote_type, fixture.expected.remote_type);
  assert.equal(normalized.source_evidence.location_source, fixture.expected.location_source);
  assert.equal(normalized.source_evidence.location_path, fixture.expected.location_path);
  assert.equal(normalized.source_evidence.location_rule_name, fixture.expected.location_rule_name);
  assert.deepEqual(normalized.source_failure_reasons || [], []);
  assert.equal(evaluatePublicPosting(normalized, { parserVersion: source.parserVersion }).status, "accepted");
});

test("hrmdirect source module does not publish list state abbreviation as city", async () => {
  const source = getSourceModule("hrmdirect");
  const sourceDir = path.join(__dirname, "hrmdirect");
  const fixture = readJson(path.join(sourceDir, "fixtures", "list-state-abbreviation-location.json"));

  const raw = await source.fetchList(fixture.company, {
    fetcher: async (url) => {
      if (url === fixture.search_list_url) return { html: fixture.list_html, status: 200, url };
      if (url === fixture.rss_url) return { html: "", status: 404, url };
      return { html: "", status: 404, url };
    }
  });
  const [posting] = source.parse(raw, fixture.company);
  const normalized = source.normalize(posting, fixture.company);

  assert.equal(normalized.source_job_id, fixture.expected.source_job_id);
  assert.equal(normalized.location_text, fixture.expected.location_text);
  assert.equal(normalized.city || "", fixture.expected.city);
  assert.equal(normalized.country, fixture.expected.country);
  assert.equal(normalized.remote_type, fixture.expected.remote_type);
  assert.equal(normalized.source_evidence.location_source, fixture.expected.location_source);
  assert.equal(normalized.source_evidence.location_path, fixture.expected.location_path);
  assert.equal(normalized.source_evidence.location_rule_name, fixture.expected.location_rule_name);
  assert.deepEqual(normalized.source_failure_reasons || [], []);
  assert.equal(evaluatePublicPosting(normalized, { parserVersion: source.parserVersion }).status, "accepted");
});

test("hrmdirect source module accepts labeled detail office state as geo evidence", async () => {
  const source = getSourceModule("hrmdirect");
  const sourceDir = path.join(__dirname, "hrmdirect");
  const fixture = readJson(path.join(sourceDir, "fixtures", "office-state-location.json"));

  const raw = await source.fetchList(fixture.company, {
    fetcher: async (url) => {
      if (url === fixture.search_list_url) {
        return {
          html: fixture.list_html,
          status: 200,
          url
        };
      }
      if (url === fixture.detail_url) {
        return {
          html: fixture.detail_html,
          status: 200,
          url
        };
      }
      return { html: "", status: 404, url };
    }
  });

  const [posting] = source.parse(raw, fixture.company);
  const normalized = source.normalize(posting, fixture.company);

  assert.equal(normalized.source_job_id, fixture.expected.source_job_id);
  assert.equal(normalized.location_text, fixture.expected.location_text);
  assert.equal(normalized.country, fixture.expected.country);
  assert.equal(normalized.city || "", fixture.expected.city);
  assert.equal(normalized.remote_type, fixture.expected.remote_type);
  assert.equal(normalized.source_evidence.location_source, fixture.expected.location_source);
  assert.equal(normalized.source_evidence.location_path, fixture.expected.location_path);
  assert.equal(normalized.source_evidence.location_rule_name, fixture.expected.location_rule_name);
  assert.deepEqual(normalized.source_failure_reasons || [], []);
  assert.equal(evaluatePublicPosting(normalized, { parserVersion: source.parserVersion }).status, "accepted");
});

test("hrmdirect source module accepts labeled detail office country as geo evidence", async () => {
  const source = getSourceModule("hrmdirect");
  const sourceDir = path.join(__dirname, "hrmdirect");
  const fixture = readJson(path.join(sourceDir, "fixtures", "office-country-location.json"));

  const raw = await source.fetchList(fixture.company, {
    fetcher: async (url) => {
      if (url === fixture.search_list_url) return { html: fixture.list_html, status: 200, url };
      if (url === fixture.detail_url) return { html: fixture.detail_html, status: 200, url };
      return { html: "", status: 404, url };
    }
  });

  const [posting] = source.parse(raw, fixture.company);
  const normalized = source.normalize(posting, fixture.company);

  assert.equal(normalized.source_job_id, fixture.expected.source_job_id);
  assert.equal(normalized.location_text, fixture.expected.location_text);
  assert.equal(normalized.country, fixture.expected.country);
  assert.equal(normalized.city || "", fixture.expected.city);
  assert.equal(normalized.remote_type, fixture.expected.remote_type);
  assert.equal(normalized.source_evidence.location_source, fixture.expected.location_source);
  assert.equal(normalized.source_evidence.location_path, fixture.expected.location_path);
  assert.equal(normalized.source_evidence.location_rule_name, fixture.expected.location_rule_name);
  assert.deepEqual(normalized.source_failure_reasons || [], []);
  assert.equal(evaluatePublicPosting(normalized, { parserVersion: source.parserVersion }).status, "accepted");
});

test("hrmdirect source module parses labeled list office prefixes as geo evidence", () => {
  const source = getSourceModule("hrmdirect");
  const sourceDir = path.join(__dirname, "hrmdirect");
  const fixture = readJson(path.join(sourceDir, "fixtures", "office-prefixed-location.json"));

  const parsed = source.parse({
    html: fixture.list_html,
    __listUrl: fixture.search_list_url,
    __rssXml: fixture.rss_xml
  }, fixture.company);
  const normalized = Object.fromEntries(parsed.map((posting) => {
    const row = source.normalize(posting, fixture.company);
    return [row.source_job_id, row];
  }));

  for (const [id, expected] of Object.entries(fixture.expected)) {
    const row = normalized[id];
    assert.ok(row, `expected ${id} to be parsed`);
    assert.equal(row.location_text || "", expected.location_text);
    assert.equal(row.country || "", expected.country);
    assert.equal(row.city || "", expected.city);
    assert.equal(row.remote_type, expected.remote_type);
    assert.equal(row.posting_date, fixture.posting_date);
    assert.equal(row.source_evidence.posting_date_source, "rss_xml");
    if (expected.location_path) {
      assert.equal(row.source_evidence.location_source, "labeled_html");
      assert.equal(row.source_evidence.location_path, expected.location_path);
      assert.equal(row.source_evidence.location_rule_name, expected.location_rule_name);
    }
    if (expected.remote_path) {
      assert.equal(row.source_evidence.remote_source, "labeled_html");
      assert.equal(row.source_evidence.remote_path, expected.remote_path);
      assert.equal(row.source_evidence.remote_rule_name, expected.remote_rule_name);
    }
    if (expected.source_failure_reasons) {
      assert.deepEqual(row.source_failure_reasons || [], expected.source_failure_reasons);
    } else {
      assert.deepEqual(row.source_failure_reasons || [], []);
    }
    assert.equal(evaluatePublicPosting(row, { parserVersion: source.parserVersion }).status, expected.public_gate_status);
  }
});

test("hrmdirect source module keeps list city evidence when office supplies country", () => {
  const source = getSourceModule("hrmdirect");
  const company = {
    company_name: "Fixture HRMDirect Office Country With City",
    ATS_name: "hrmdirect",
    url_string: "https://officecity.hrmdirect.com/employment/job-openings.php"
  };
  const [posting] = source.parse({
    html: `<table><tr class="reqitem" data-req-id="HRM9201">
      <td class="posTitle reqitem ReqRowClick"><a href="job-opening.php?req=HRM9201&req_loc=2001">Offshore Doctor Guyana</a></td>
      <td class="cities reqitem ReqRowClick">Georgetown</td>
      <td class="state reqitem ReqRowClick">Georgetown</td>
      <td class="offices reqitem ReqRowClick">Corporate Guyana</td>
    </tr></table>`,
    __listUrl: "https://officecity.hrmdirect.com/employment/job-openings.php?search=true"
  }, company);
  const normalized = source.normalize(posting, company);

  assert.equal(normalized.location_text, "Georgetown, Georgetown");
  assert.equal(normalized.city, "Georgetown");
  assert.equal(normalized.country, "Guyana");
  assert.equal(normalized.source_evidence.location_path, "td.cities + td.state");
  assert.equal(normalized.source_evidence.location_rule_name, "");
  assert.equal(evaluatePublicPosting(normalized, { parserVersion: source.parserVersion }).status, "accepted");
});

test("hrmdirect source module accepts exact Office Remote as remote evidence", async () => {
  const source = getSourceModule("hrmdirect");
  const sourceDir = path.join(__dirname, "hrmdirect");
  const fixture = readJson(path.join(sourceDir, "fixtures", "office-remote-evidence.json"));

  const raw = await source.fetchList(fixture.company, {
    fetcher: async (url) => {
      if (url === fixture.search_list_url) return { html: fixture.list_html, status: 200, url };
      if (url === fixture.rss_url) return { html: "", status: 404, url };
      for (const [sourceJobId, detailUrl] of Object.entries(fixture.detail_urls)) {
        if (url === detailUrl) return { html: fixture.detail_html[sourceJobId], status: 200, url };
      }
      return { html: "", status: 404, url };
    }
  });
  const normalized = Object.fromEntries(source.parse(raw, fixture.company).map((posting) => {
    const row = source.normalize(posting, fixture.company);
    return [row.source_job_id, row];
  }));

  for (const [sourceJobId, expected] of Object.entries(fixture.expected)) {
    const row = normalized[sourceJobId];
    assert.ok(row, `expected row ${sourceJobId}`);
    assert.equal(row.location_text, expected.location_text);
    assert.equal(row.city || "", expected.city);
    assert.equal(row.country || "", expected.country);
    assert.equal(row.remote_type, expected.remote_type);
    assert.equal(row.source_evidence.remote_source, expected.remote_source);
    assert.equal(row.source_evidence.remote_path, expected.remote_path);
    assert.equal(row.source_evidence.remote_rule_name, expected.remote_rule_name);
    assert.deepEqual(row.source_failure_reasons || [], []);
    assert.equal(evaluatePublicPosting(row, { parserVersion: source.parserVersion }).status, "accepted");
  }
});

test("hrmdirect source module skips exact Apply Today placeholder titles", async () => {
  const source = getSourceModule("hrmdirect");
  const sourceDir = path.join(__dirname, "hrmdirect");
  const fixture = readJson(path.join(sourceDir, "fixtures", "placeholder-title.json"));

  const raw = await source.fetchList(fixture.company, {
    fetcher: async (url) => {
      if (url === fixture.search_list_url) return { html: fixture.list_html, status: 200, url };
      if (url === fixture.rss_url) return { html: "", status: 404, url };
      return { html: "", status: 404, url };
    }
  });
  const rows = source.parse(raw, fixture.company).map((posting) => source.normalize(posting, fixture.company));
  const sourceJobIds = rows.map((row) => row.source_job_id).sort();

  assert.deepEqual(sourceJobIds, fixture.expected_source_job_ids.slice().sort());
  for (const sourceJobId of fixture.rejected_source_job_ids) {
    assert.equal(sourceJobIds.includes(sourceJobId), false, `${sourceJobId} should not parse as a real posting`);
  }
});

test("hrmdirect source module parses labeled detail office prefixes as geo evidence", async () => {
  const source = getSourceModule("hrmdirect");
  const company = {
    company_name: "Fixture HRMDirect Detail Office Prefix",
    ATS_name: "hrmdirect",
    url_string: "https://detailofficeprefix.hrmdirect.com/employment/job-openings.php"
  };
  const searchListUrl = "https://detailofficeprefix.hrmdirect.com/employment/job-openings.php?search=true";
  const detailUrl = "https://detailofficeprefix.hrmdirect.com/employment/job-opening.php?req=HRM9301";
  const raw = await source.fetchList(company, {
    fetcher: async (url) => {
      if (url === searchListUrl) {
        return {
          html: `<table><tr class="reqitem" data-req-id="HRM9301">
            <td class="posTitle reqitem ReqRowClick"><a href="job-opening.php?req=HRM9301&req_loc=3001">UK Offshore Medic</a></td>
            <td class="cities reqitem ReqRowClick"></td>
            <td class="state reqitem ReqRowClick"></td>
          </tr></table>`,
          status: 200,
          url
        };
      }
      if (url === "https://detailofficeprefix.hrmdirect.com/employment/rss.php?search=true") {
        return { html: "", status: 404, url };
      }
      if (url === detailUrl) {
        return {
          html: `<table class="viewFields">
            <tr><td class="viewFieldName"><b>Office:</b></td><td class="viewFieldValue">Field UK Onshore</td></tr>
          </table>`,
          status: 200,
          url
        };
      }
      return { html: "", status: 404, url };
    }
  });
  const [posting] = source.parse(raw, company);
  const normalized = source.normalize(posting, company);

  assert.equal(normalized.location_text, "United Kingdom");
  assert.equal(normalized.country, "United Kingdom");
  assert.equal(normalized.city || "", "");
  assert.equal(normalized.remote_type, "unknown");
  assert.equal(normalized.source_evidence.location_source, "labeled_detail_html");
  assert.equal(normalized.source_evidence.location_path, "table.viewFields Office");
  assert.equal(normalized.source_evidence.location_rule_name, "hrmdirect_detail_office_country_prefixed");
  assert.deepEqual(normalized.source_failure_reasons || [], []);
  assert.equal(evaluatePublicPosting(normalized, { parserVersion: source.parserVersion }).status, "accepted");
});

test("hrmdirect source module accepts labeled detail office province as geo evidence", async () => {
  const source = getSourceModule("hrmdirect");
  const sourceDir = path.join(__dirname, "hrmdirect");
  const fixture = readJson(path.join(sourceDir, "fixtures", "office-province-location.json"));

  const raw = await source.fetchList(fixture.company, {
    fetcher: async (url) => {
      if (url === fixture.search_list_url) return { html: fixture.list_html, status: 200, url };
      if (url === fixture.detail_url) return { html: fixture.detail_html, status: 200, url };
      return { html: "", status: 404, url };
    }
  });

  const [posting] = source.parse(raw, fixture.company);
  const normalized = source.normalize(posting, fixture.company);

  assert.equal(normalized.source_job_id, fixture.expected.source_job_id);
  assert.equal(normalized.location_text, fixture.expected.location_text);
  assert.equal(normalized.country, fixture.expected.country);
  assert.equal(normalized.city || "", fixture.expected.city);
  assert.equal(normalized.remote_type, fixture.expected.remote_type);
  assert.equal(normalized.source_evidence.location_source, fixture.expected.location_source);
  assert.equal(normalized.source_evidence.location_path, fixture.expected.location_path);
  assert.equal(normalized.source_evidence.location_rule_name, fixture.expected.location_rule_name);
  assert.deepEqual(normalized.source_failure_reasons || [], []);
  assert.equal(evaluatePublicPosting(normalized, { parserVersion: source.parserVersion }).status, "accepted");
});

test("hrmdirect source module uses RSS pubDate as posting date evidence", async () => {
  const source = getSourceModule("hrmdirect");
  const sourceDir = path.join(__dirname, "hrmdirect");
  const fixture = readJson(path.join(sourceDir, "fixtures", "rss-posting-date.json"));
  const requestedUrls = [];

  const raw = await source.fetchList(fixture.company, {
    fetcher: async (url) => {
      requestedUrls.push(String(url));
      if (url === fixture.search_list_url) return { html: fixture.list_html, status: 200, url };
      if (url === fixture.rss_url) return { html: fixture.rss_xml, status: 200, url };
      return { html: "", status: 404, url };
    }
  });
  const [posting] = source.parse(raw, fixture.company);
  const normalized = source.normalize(posting, fixture.company);

  assert.ok(requestedUrls.includes(fixture.rss_url));
  assert.equal(normalized.source_job_id, fixture.expected.source_job_id);
  assert.equal(normalized.posting_date, fixture.expected.posting_date);
  assert.equal(normalized.posting_date_epoch, fixture.expected.posting_date_epoch);
  assert.equal(normalized.source_evidence.posting_date_source, fixture.expected.posting_date_source);
  assert.equal(normalized.source_evidence.posting_date_path, fixture.expected.posting_date_path);
  assert.equal(normalized.source_evidence.posting_date_rule_name, fixture.expected.posting_date_rule_name);
  assert.deepEqual(normalized.source_failure_reasons || [], []);
  assert.equal(evaluatePublicPosting(normalized, { parserVersion: source.parserVersion }).status, "accepted");
});

test("hrmdirect source module uses RSS pubDate for openings.php routes", async () => {
  const source = getSourceModule("hrmdirect");
  const sourceDir = path.join(__dirname, "hrmdirect");
  const fixture = readJson(path.join(sourceDir, "fixtures", "openings-route-rss-posting-date.json"));
  const requestedUrls = [];

  const raw = await source.fetchList(fixture.company, {
    fetcher: async (url) => {
      requestedUrls.push(String(url));
      if (url === fixture.search_list_url) return { html: fixture.list_html, status: 200, url };
      if (url === fixture.rss_url) return { html: fixture.rss_xml, status: 200, url };
      return { html: "", status: 404, url };
    }
  });
  const [posting] = source.parse(raw, fixture.company);
  const normalized = source.normalize(posting, fixture.company);

  assert.equal(source.discover(fixture.company).list_url, fixture.search_list_url);
  assert.ok(requestedUrls.includes(fixture.rss_url));
  assert.equal(normalized.source_job_id, fixture.expected.source_job_id);
  assert.equal(normalized.location_text, fixture.expected.location_text);
  assert.equal(normalized.country, fixture.expected.country);
  assert.equal(normalized.city, fixture.expected.city);
  assert.equal(normalized.posting_date, fixture.expected.posting_date);
  assert.equal(normalized.source_evidence.posting_date_source, fixture.expected.posting_date_source);
  assert.equal(normalized.source_evidence.posting_date_path, fixture.expected.posting_date_path);
  assert.equal(normalized.source_evidence.posting_date_rule_name, fixture.expected.posting_date_rule_name);
  assert.deepEqual(normalized.source_failure_reasons || [], []);
  assert.equal(evaluatePublicPosting(normalized, { parserVersion: source.parserVersion }).status, "accepted");
});

test("hrmdirect source module uses RSS guid when link does not expose req id", async () => {
  const source = getSourceModule("hrmdirect");
  const sourceDir = path.join(__dirname, "hrmdirect");
  const fixture = readJson(path.join(sourceDir, "fixtures", "rss-guid-posting-date.json"));
  const requestedUrls = [];

  const raw = await source.fetchList(fixture.company, {
    fetcher: async (url) => {
      requestedUrls.push(String(url));
      if (url === fixture.search_list_url) return { html: fixture.list_html, status: 200, url };
      if (url === fixture.rss_url) return { html: fixture.rss_xml, status: 200, url };
      return { html: "", status: 404, url };
    }
  });
  const [posting] = source.parse(raw, fixture.company);
  const normalized = source.normalize(posting, fixture.company);

  assert.ok(requestedUrls.includes(fixture.rss_url));
  assert.equal(normalized.source_job_id, fixture.expected.source_job_id);
  assert.equal(normalized.posting_date, fixture.expected.posting_date);
  assert.equal(normalized.posting_date_epoch, fixture.expected.posting_date_epoch);
  assert.equal(normalized.source_evidence.posting_date_source, fixture.expected.posting_date_source);
  assert.equal(normalized.source_evidence.posting_date_path, fixture.expected.posting_date_path);
  assert.equal(normalized.source_evidence.posting_date_rule_name, fixture.expected.posting_date_rule_name);
  assert.deepEqual(normalized.source_failure_reasons || [], []);
  assert.equal(evaluatePublicPosting(normalized, { parserVersion: source.parserVersion }).status, "accepted");
});

test("hrmdirect source module uses labeled detail date when list and RSS dates are absent", async () => {
  const source = getSourceModule("hrmdirect");
  const sourceDir = path.join(__dirname, "hrmdirect");
  const fixture = readJson(path.join(sourceDir, "fixtures", "detail-posting-date.json"));

  const raw = await source.fetchList(fixture.company, {
    fetcher: async (url) => {
      if (url === fixture.search_list_url) return { html: fixture.list_html, status: 200, url };
      if (url === fixture.rss_url) return { html: "", status: 404, url };
      if (url === fixture.detail_url) return { html: fixture.detail_html, status: 200, url };
      return { html: "", status: 404, url };
    }
  });
  const [posting] = source.parse(raw, fixture.company);
  const normalized = source.normalize(posting, fixture.company);

  assert.equal(normalized.source_job_id, fixture.expected.source_job_id);
  assert.equal(normalized.location, fixture.expected.location);
  assert.equal(normalized.posting_date, fixture.expected.posting_date);
  assert.equal(normalized.posting_date_epoch, fixture.expected.posting_date_epoch);
  assert.equal(normalized.source_evidence.posting_date_source, fixture.expected.posting_date_source);
  assert.equal(normalized.source_evidence.posting_date_path, fixture.expected.posting_date_path);
  assert.equal(normalized.source_evidence.posting_date_rule_name, fixture.expected.posting_date_rule_name);
  assert.deepEqual(normalized.source_failure_reasons || [], []);
  assert.equal(evaluatePublicPosting(normalized, { parserVersion: source.parserVersion }).status, "accepted");
});

test("hrmdirect source module uses search=true route and parses work-mode location cells", async () => {
  const source = getSourceModule("hrmdirect");
  const sourceDir = path.join(__dirname, "hrmdirect");
  const fixture = readJson(path.join(sourceDir, "fixtures", "work-mode-location.json"));
  const requestedUrls = [];

  const raw = await source.fetchList(fixture.company, {
    fetcher: async (url) => {
      requestedUrls.push(String(url));
      if (url === fixture.search_list_url) return { html: fixture.list_html, status: 200, url };
      if (fixture.details?.[url]) return { html: fixture.details[url], status: 200, url };
      return { html: fixture.empty_list_html, status: 200, url };
    }
  });
  const parsed = source.parse(raw, fixture.company);
  const normalized = Object.fromEntries(parsed.map((posting) => {
    const row = source.normalize(posting, fixture.company);
    return [row.source_job_id, row];
  }));

  assert.equal(source.discover(fixture.company).list_url, fixture.search_list_url);
  assert.equal(requestedUrls[0], fixture.search_list_url);
  assert.ok(requestedUrls.includes(fixture.detail_url_without_filter));
  assert.equal(normalized.HRM5001.location_text, fixture.expected.HRM5001.location_text);
  assert.equal(normalized.HRM5001.country, fixture.expected.HRM5001.country);
  assert.equal(normalized.HRM5001.city, fixture.expected.HRM5001.city);
  assert.equal(normalized.HRM5001.remote_type, fixture.expected.HRM5001.remote_type);
  assert.equal(normalized.HRM5001.department, fixture.expected.HRM5001.department);
  assert.equal(normalized.HRM5001.posting_date, fixture.expected.HRM5001.posting_date);
  assert.equal(normalized.HRM5001.source_evidence.location_path, "td.custSort1");
  assert.deepEqual(normalized.HRM5001.source_failure_reasons || [], []);
  assert.equal(evaluatePublicPosting(normalized.HRM5001, { parserVersion: source.parserVersion }).status, "accepted");

  assert.equal(normalized.HRM5002.location_text || "", fixture.expected.HRM5002.location_text);
  assert.equal(normalized.HRM5002.remote_type, fixture.expected.HRM5002.remote_type);
  assert.equal(normalized.HRM5002.posting_date, fixture.expected.HRM5002.posting_date);
  assert.deepEqual(normalized.HRM5002.source_failure_reasons || [], []);
  assert.equal(evaluatePublicPosting(normalized.HRM5002, { parserVersion: source.parserVersion }).status, "accepted");

  assert.equal(normalized.HRM5003.location_text, fixture.expected.HRM5003.location_text);
  assert.equal(normalized.HRM5003.country, fixture.expected.HRM5003.country);
  assert.equal(normalized.HRM5003.remote_type, fixture.expected.HRM5003.remote_type);
  assert.equal(normalized.HRM5003.department, fixture.expected.HRM5003.department);
  assert.equal(normalized.HRM5003.posting_date, fixture.expected.HRM5003.posting_date);
  assert.deepEqual(normalized.HRM5003.source_failure_reasons || [], []);
  assert.equal(evaluatePublicPosting(normalized.HRM5003, { parserVersion: source.parserVersion }).status, "accepted");

  assert.equal(normalized.HRM5004.location_text, fixture.expected.HRM5004.location_text);
  assert.equal(normalized.HRM5004.country, fixture.expected.HRM5004.country);
  assert.equal(normalized.HRM5004.city, fixture.expected.HRM5004.city);
  assert.equal(normalized.HRM5004.remote_type, fixture.expected.HRM5004.remote_type);
  assert.equal(normalized.HRM5004.department, fixture.expected.HRM5004.department);
  assert.equal(normalized.HRM5004.posting_date, fixture.expected.HRM5004.posting_date);
  assert.deepEqual(normalized.HRM5004.source_failure_reasons || [], []);
  assert.equal(evaluatePublicPosting(normalized.HRM5004, { parserVersion: source.parserVersion }).status, "accepted");

  assert.equal(normalized.HRM5005.location_text, fixture.expected.HRM5005.location_text);
  assert.equal(normalized.HRM5005.country, fixture.expected.HRM5005.country);
  assert.equal(normalized.HRM5005.city, fixture.expected.HRM5005.city);
  assert.equal(normalized.HRM5005.remote_type, fixture.expected.HRM5005.remote_type);
  assert.equal(normalized.HRM5005.department, fixture.expected.HRM5005.department);
  assert.equal(normalized.HRM5005.posting_date, fixture.expected.HRM5005.posting_date);
  assert.deepEqual(normalized.HRM5005.source_failure_reasons || [], []);
  assert.equal(evaluatePublicPosting(normalized.HRM5005, { parserVersion: source.parserVersion }).status, "accepted");

  assert.equal(normalized.HRM5006.location_text || "", fixture.expected.HRM5006.location_text);
  assert.equal(normalized.HRM5006.country || "", fixture.expected.HRM5006.country);
  assert.equal(normalized.HRM5006.city || "", fixture.expected.HRM5006.city);
  assert.equal(normalized.HRM5006.remote_type, fixture.expected.HRM5006.remote_type);
  assert.equal(normalized.HRM5006.department, fixture.expected.HRM5006.department);
  assert.equal(normalized.HRM5006.posting_date, fixture.expected.HRM5006.posting_date);
  assert.deepEqual(normalized.HRM5006.source_failure_reasons || [], fixture.expected.HRM5006.source_failure_reasons);
  assert.equal(evaluatePublicPosting(normalized.HRM5006, { parserVersion: source.parserVersion }).status, "quarantined");

  assert.equal(normalized.HRM5007.location_text, fixture.expected.HRM5007.location_text);
  assert.equal(normalized.HRM5007.country, fixture.expected.HRM5007.country);
  assert.equal(normalized.HRM5007.city, fixture.expected.HRM5007.city);
  assert.equal(normalized.HRM5007.remote_type, fixture.expected.HRM5007.remote_type);
  assert.equal(normalized.HRM5007.department, fixture.expected.HRM5007.department);
  assert.equal(normalized.HRM5007.posting_date, fixture.expected.HRM5007.posting_date);
  assert.deepEqual(normalized.HRM5007.source_failure_reasons || [], []);
  assert.equal(evaluatePublicPosting(normalized.HRM5007, { parserVersion: source.parserVersion }).status, "accepted");

  assert.equal(normalized.HRM5008.location_text || "", fixture.expected.HRM5008.location_text);
  assert.equal(normalized.HRM5008.country || "", fixture.expected.HRM5008.country);
  assert.equal(normalized.HRM5008.city || "", fixture.expected.HRM5008.city);
  assert.equal(normalized.HRM5008.remote_type, fixture.expected.HRM5008.remote_type);
  assert.equal(normalized.HRM5008.department, fixture.expected.HRM5008.department);
  assert.equal(normalized.HRM5008.posting_date, fixture.expected.HRM5008.posting_date);
  assert.equal(normalized.HRM5008.source_evidence.remote_source, fixture.expected.HRM5008.remote_source);
  assert.equal(normalized.HRM5008.source_evidence.remote_path, fixture.expected.HRM5008.remote_path);
  assert.deepEqual(normalized.HRM5008.source_failure_reasons || [], []);
  assert.equal(evaluatePublicPosting(normalized.HRM5008, { parserVersion: source.parserVersion }).status, "accepted");
});

test("hrmdirect source module adapts detail budget for sparse mid-sized boards", async () => {
  const source = getSourceModule("hrmdirect");
  const company = {
    company_name: "Fixture HRMDirect Sparse",
    ATS_name: "hrmdirect",
    url_string: "https://sparse.hrmdirect.com/employment/job-openings.php"
  };
  const searchListUrl = "https://sparse.hrmdirect.com/employment/job-openings.php?search=true";
  const rows = Array.from({ length: 12 }, (_, index) => {
    const id = `HRM6${String(index + 1).padStart(3, "0")}`;
    return `<tr class="reqitem" data-req-id="${id}">
      <td class="departments reqitem ReqRowClick">Engineering</td>
      <td class="posTitle reqitem ReqRowClick"><a href="job-opening.php?req=${id}&req_loc=${9000 + index}&cust_sort1=245588&&amp;#job">Sparse Role ${index + 1}</a></td>
      <td class="cities reqitem ReqRowClick"></td>
      <td class="state reqitem ReqRowClick"></td>
    </tr>`;
  }).join("");
  const lastDetailUrl = "https://sparse.hrmdirect.com/employment/job-opening.php?req=HRM6012";
  const requestedUrls = [];

  const raw = await source.fetchList(company, {
    fetcher: async (url) => {
      requestedUrls.push(String(url));
      if (url === searchListUrl) return { html: `<table>${rows}</table>`, status: 200, url };
      if (url === lastDetailUrl) {
        return {
          html: `<table class="viewFields">
            <tr><td class="viewFieldName"><b>Department:</b></td><td class="viewFieldValue">Engineering</td></tr>
            <tr><td class="viewFieldName"><b>Location:</b></td><td class="viewFieldValue">Mc Lean, VA</td></tr>
          </table>`,
          status: 200,
          url
        };
      }
      return {
        html: `<table class="viewFields">
          <tr><td class="viewFieldName"><b>Department:</b></td><td class="viewFieldValue">Engineering</td></tr>
          <tr><td class="viewFieldName"><b>Location:</b></td><td class="viewFieldValue"></td></tr>
        </table>`,
        status: 200,
        url
      };
    }
  });

  const parsed = source.parse(raw, company);
  const normalized = Object.fromEntries(parsed.map((posting) => {
    const row = source.normalize(posting, company);
    return [row.source_job_id, row];
  }));

  assert.ok(requestedUrls.includes(lastDetailUrl));
  assert.equal(raw.__sourceConfig.detail_fetch_count, 12);
  assert.equal(normalized.HRM6012.location_text, "Mc Lean, VA");
  assert.equal(normalized.HRM6012.country, "United States");
  assert.equal(normalized.HRM6012.city, "Mc Lean");
  assert.equal(normalized.HRM6012.remote_type, "onsite");
  assert.deepEqual(normalized.HRM6012.source_failure_reasons || [], []);
  assert.equal(evaluatePublicPosting(normalized.HRM6012, { parserVersion: source.parserVersion }).status, "accepted");
});

test("hrmdirect source module expands detail budget for large sparse boards", async () => {
  const source = getSourceModule("hrmdirect");
  const previousLimit = process.env.OPENJOBSLOTS_HRMDIRECT_DETAIL_FETCH_LIMIT_PER_COMPANY;
  delete process.env.OPENJOBSLOTS_HRMDIRECT_DETAIL_FETCH_LIMIT_PER_COMPANY;
  const company = {
    company_name: "Fixture HRMDirect Large Sparse",
    ATS_name: "hrmdirect",
    url_string: "https://largesparse.hrmdirect.com/employment/job-openings.php"
  };
  const searchListUrl = "https://largesparse.hrmdirect.com/employment/job-openings.php?search=true";
  const rowCount = 90;
  const rows = Array.from({ length: rowCount }, (_, index) => {
    const id = `HRM9${String(index + 1).padStart(3, "0")}`;
    return `<tr class="reqitem" data-req-id="${id}">
      <td class="departments reqitem ReqRowClick">Operations</td>
      <td class="posTitle reqitem ReqRowClick"><a href="job-opening.php?req=${id}&req_loc=${9100 + index}&cust_sort1=245588&&amp;#job">Large Sparse Role ${index + 1}</a></td>
      <td class="cities reqitem ReqRowClick"></td>
      <td class="state reqitem ReqRowClick"></td>
    </tr>`;
  }).join("");
  const lastId = `HRM9${String(rowCount).padStart(3, "0")}`;
  const lastDetailUrl = `https://largesparse.hrmdirect.com/employment/job-opening.php?req=${lastId}`;
  const requestedUrls = [];

  try {
    const raw = await source.fetchList(company, {
      fetcher: async (url) => {
        requestedUrls.push(String(url));
        if (url === searchListUrl) return { html: `<table>${rows}</table>`, status: 200, url };
        if (url === lastDetailUrl) {
          return {
            html: `<table class="viewFields">
              <tr><td class="viewFieldName"><b>Department:</b></td><td class="viewFieldValue">Operations</td></tr>
              <tr><td class="viewFieldName"><b>Location:</b></td><td class="viewFieldValue">Jacksonville, FL</td></tr>
            </table>`,
            status: 200,
            url
          };
        }
        return {
          html: `<table class="viewFields">
            <tr><td class="viewFieldName"><b>Department:</b></td><td class="viewFieldValue">Operations</td></tr>
            <tr><td class="viewFieldName"><b>Location:</b></td><td class="viewFieldValue"></td></tr>
          </table>`,
          status: 200,
          url
        };
      }
    });

    const parsed = source.parse(raw, company);
    const normalized = Object.fromEntries(parsed.map((posting) => {
      const row = source.normalize(posting, company);
      return [row.source_job_id, row];
    }));

    assert.ok(requestedUrls.includes(lastDetailUrl));
    assert.equal(raw.__sourceConfig.detail_fetch_count, rowCount);
    assert.equal(normalized[lastId].location_text, "Jacksonville, FL");
    assert.equal(normalized[lastId].country, "United States");
    assert.equal(normalized[lastId].city, "Jacksonville");
    assert.deepEqual(normalized[lastId].source_failure_reasons || [], []);
    assert.equal(evaluatePublicPosting(normalized[lastId], { parserVersion: source.parserVersion }).status, "accepted");
  } finally {
    if (previousLimit === undefined) {
      delete process.env.OPENJOBSLOTS_HRMDIRECT_DETAIL_FETCH_LIMIT_PER_COMPANY;
    } else {
      process.env.OPENJOBSLOTS_HRMDIRECT_DETAIL_FETCH_LIMIT_PER_COMPANY = previousLimit;
    }
  }
});

test("hrmdirect source module uses req_loc detail when it exposes labeled location", async () => {
  const source = getSourceModule("hrmdirect");
  const company = {
    company_name: "Fixture HRMDirect ReqLoc",
    ATS_name: "hrmdirect",
    url_string: "https://reqloc.hrmdirect.com/employment/job-openings.php"
  };
  const searchListUrl = "https://reqloc.hrmdirect.com/employment/job-openings.php?search=true";
  const reqOnlyDetailUrl = "https://reqloc.hrmdirect.com/employment/job-opening.php?req=HRM9201";
  const reqLocDetailUrl = "https://reqloc.hrmdirect.com/employment/job-opening.php?req=HRM9201&req_loc=12001";
  const secondReqLocDetailUrl = "https://reqloc.hrmdirect.com/employment/job-opening.php?req=HRM9201&req_loc=12002";
  const requestedUrls = [];

  const raw = await source.fetchList(company, {
    fetcher: async (url) => {
      requestedUrls.push(String(url));
      if (url === searchListUrl) {
        return {
          html: `<table><tr class="reqitem" data-req-id="HRM9201">
            <td class="departments reqitem ReqRowClick">Clinical</td>
            <td class="posTitle reqitem ReqRowClick"><a href="job-opening.php?req=HRM9201&req_loc=12001&cust_sort1=245588&&amp;#job">Clinic Role</a></td>
            <td class="cities reqitem ReqRowClick"></td>
            <td class="state reqitem ReqRowClick"></td>
          </tr><tr class="reqitem1" data-req-id="HRM9201">
            <td class="departments reqitem1 ReqRowClick">Clinical</td>
            <td class="posTitle reqitem1 ReqRowClick"><a href="job-opening.php?req=HRM9201&req_loc=12002&cust_sort1=245588&&amp;#job">Clinic Role</a></td>
            <td class="cities reqitem1 ReqRowClick"></td>
            <td class="state reqitem1 ReqRowClick"></td>
          </tr></table>`,
          status: 200,
          url
        };
      }
      if (url === reqOnlyDetailUrl) {
        return {
          html: `<table class="viewFields">
            <tr><td class="viewFieldName"><b>Department:</b></td><td class="viewFieldValue">Clinical</td></tr>
            <tr><td class="viewFieldName"><b>Location:</b></td><td class="viewFieldValue"></td></tr>
          </table>`,
          status: 200,
          url
        };
      }
      if (url === reqLocDetailUrl) {
        return {
          html: `<table class="viewFields">
            <tr><td class="viewFieldName"><b>Department:</b></td><td class="viewFieldValue">Clinical</td></tr>
            <tr><td class="viewFieldName"><b>Location:</b></td><td class="viewFieldValue">Orlando</td></tr>
          </table>`,
          status: 200,
          url
        };
      }
      if (url === secondReqLocDetailUrl) {
        return {
          html: `<table class="viewFields">
            <tr><td class="viewFieldName"><b>Department:</b></td><td class="viewFieldValue">Clinical</td></tr>
            <tr><td class="viewFieldName"><b>Location:</b></td><td class="viewFieldValue">Vero Beach</td></tr>
          </table>`,
          status: 200,
          url
        };
      }
      return { html: "", status: 404, url };
    }
  });

  const parsed = source.parse(raw, company);
  const normalized = Object.fromEntries(parsed.map((posting) => {
    const row = source.normalize(posting, company);
    return [row.canonical_url, row];
  }));
  const row = normalized[reqLocDetailUrl];

  assert.equal(new Set(Object.values(normalized).map((posting) => posting.source_job_id)).size, 2);
  assert.ok(requestedUrls.includes(reqLocDetailUrl));
  assert.equal(row.source_job_id, "HRM9201:12001");
  assert.equal(row.source_evidence.source_job_id_path, "req + req_loc query params");
  assert.equal(row.location_text, "Orlando");
  assert.equal(row.city, "Orlando");
  assert.deepEqual(row.source_failure_reasons || [], []);
  assert.equal(evaluatePublicPosting(row, { parserVersion: source.parserVersion }).status, "accepted");
});

test("hrmdirect source module reports stale detail failures as quarantine reasons", async () => {
  const source = getSourceModule("hrmdirect");
  const sourceDir = path.join(__dirname, "hrmdirect");
  const fixture = readJson(path.join(sourceDir, "fixtures", "stale-detail.json"));

  const raw = await source.fetchList(fixture.company, {
    fetcher: async (url) => {
      if (url === fixture.search_list_url) return { html: fixture.list_html, status: 200, url };
      if (url === fixture.rss_url) return { html: "", status: 404, url };
      if (url === fixture.detail_url) {
        const error = new Error("detail removed");
        error.status = 404;
        throw error;
      }
      return { html: "", status: 404, url };
    }
  });
  const [posting] = source.parse(raw, fixture.company);
  const normalized = source.normalize(posting, fixture.company);

  assert.equal(raw.__sourceConfig.detail_fetch_count, fixture.expected.detail_fetch_count);
  assert.equal(normalized.source_job_id, fixture.expected.source_job_id);
  for (const reason of fixture.expected.source_failure_reasons) {
    assert.ok(normalized.source_failure_reasons.includes(reason), `missing ${reason}`);
  }
  assert.equal(evaluatePublicPosting(normalized, { parserVersion: source.parserVersion }).status, "quarantined");
});

test("hrmdirect source module quarantines onsite rows when geo evidence is absent", () => {
  const source = getSourceModule("hrmdirect");
  const company = {
    company_name: "Fixture HRMDirect Onsite Missing Geo",
    ATS_name: "hrmdirect",
    url_string: "https://onsitemissinggeo.hrmdirect.com/employment/job-openings.php"
  };
  const detailUrl = "https://onsitemissinggeo.hrmdirect.com/employment/job-opening.php?req=HRM9301&req_loc=13001";
  const parsed = source.parse({
    html: `
      <table>
        <tr class="reqitem" data-req-id="HRM9301">
          <td class="custSort1 reqitem ReqRowClick">Onsite</td>
          <td class="departments reqitem ReqRowClick">Operations</td>
          <td class="posTitle reqitem ReqRowClick">
            <a href="job-opening.php?req=HRM9301&req_loc=13001">Operations Specialist</a>
          </td>
          <td class="cities reqitem ReqRowClick"></td>
          <td class="state reqitem ReqRowClick"></td>
        </tr>
      </table>
    `,
    __listUrl: company.url_string,
    __detailHtmlByUrl: {
      [detailUrl]: `
        <table class="viewFields">
          <tr><td class="viewFieldName"><b>Department:</b></td><td class="viewFieldValue">Operations</td></tr>
          <tr><td class="viewFieldName"><b>Location:</b></td><td class="viewFieldValue"></td></tr>
        </table>
      `
    }
  }, company);

  assert.equal(parsed.length, 1);
  const normalized = source.normalize(parsed[0], company);
  assert.equal(normalized.remote_type, "onsite");
  assert.ok(normalized.source_failure_reasons.includes("no_geo_no_remote"));
  assert.ok(normalized.source_failure_reasons.includes("detail_no_structured_location"));
  assert.equal(evaluatePublicPosting(normalized, { parserVersion: source.parserVersion }).status, "quarantined");
});

test("hrmdirect source module uses labeled remote column without publishing comma-only locations", () => {
  const source = getSourceModule("hrmdirect");
  const company = readJson(path.join(__dirname, "hrmdirect", "fixtures", "company.json"));
  const parsed = source.parse({
    html: `
      <table>
        <tr class="reqitem" data-req-id="HRM4001">
          <td class="leftBorder">&nbsp;</td>
          <td id="custSort10" class="custSort1 reqitem ReqRowClick">Remote&nbsp;</td>
          <td id="departments0" class="departments reqitem ReqRowClick">Colleague</td>
          <td id="posTitle0" class="posTitle reqitem ReqRowClick">
            <a href="job-opening.php?req=HRM4001&req_loc=1326820&&amp;#job">Colleague SaaS Technical Consultant</a>
          </td>
          <td id="cities0" class="cities reqitem ReqRowClick"></td>
          <td id="state0" class="state reqitem ReqRowClick"></td>
        </tr>
      </table>
    `,
    __listUrl: company.url_string,
    __detailHtmlByUrl: {
      "https://fixture.hrmdirect.com/employment/job-opening.php?req=HRM4001&req_loc=1326820": `
        <html>
          <body>
            <table class="viewFields">
              <tr><td class="viewFieldName"><b>Department:</b></td><td class="viewFieldValue">Colleague</td></tr>
              <tr><td class="viewFieldName"><b>Location:</b></td><td class="viewFieldValue"><br />, <br></td></tr>
            </table>
          </body>
        </html>
      `
    }
  }, company);

  assert.equal(parsed.length, 1);
  const normalized = source.normalize(parsed[0], company);
  assert.equal(normalized.location_text || "", "");
  assert.equal(normalized.city || "", "");
  assert.equal(normalized.country || "", "");
  assert.equal(normalized.remote_type, "remote");
  assert.equal(normalized.source_evidence.remote_source, "labeled_html");
  assert.equal(normalized.source_evidence.remote_path, "td.custSort1");
  assert.equal(evaluatePublicPosting(normalized, { parserVersion: source.parserVersion }).status, "accepted");
});
