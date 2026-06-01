const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluatePublicPosting } = require("../publicPostingGate");
const { getSourceModule } = require("./index");

const HTML_PUBLIC_SOURCES = Object.freeze([
  "applitrack",
  "applicantai",
  "hirebridge",
  "jobaps",
  "jobvite",
  "careerplug",
  "theapplicantmanager",
  "careerspage",
  "talentreef",
  "talentlyft",
  "join",
  "teamtailor",
  "freshteam",
  "getro",
  "governmentjobs",
  "usajobs",
  "k12jobspot",
  "schoolspring",
  "simplicant",
  "statejobsny",
  "calcareers",
  "calopps",
  "hibob",
  "hrmdirect",
  "breezy",
  "loxo",
  "applytojob"
]);

const QUARANTINED_HTML_PUBLIC_SOURCES = Object.freeze([
  {
    atsKey: "peopleforce",
    sourceFamilies: ["html_detail"],
    reasonCodes: ["missing_source_job_id"]
  },
  {
    atsKey: "policeapp",
    sourceFamilies: ["html_public_ajax"],
    reasonCodes: ["missing_source_job_id", "no_geo_no_remote"]
  },
  {
    atsKey: "sagehr",
    sourceFamilies: ["html_detail"],
    reasonCodes: ["missing_source_job_id", "no_geo_no_remote"]
  }
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
    assert.ok(["html_detail", "public_sector", "embedded_json"].includes(discovered.source_family));
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

for (const { atsKey, sourceFamilies, reasonCodes } of QUARANTINED_HTML_PUBLIC_SOURCES) {
  test(`${atsKey} html/public source module parses fixture with quarantined public-gate evidence`, () => {
    const source = getSourceModule(atsKey);
    assert.ok(source, `expected source module ${atsKey}`);
    const sourceDir = path.join(__dirname, atsKey);
    const company = readJson(path.join(sourceDir, "fixtures", "company.json"));
    const rawList = readJson(path.join(sourceDir, "fixtures", "list.json"));
    const expectedRows = readJson(path.join(sourceDir, "fixtures", "expected-normalized.json"));

    const discovered = source.discover(company);
    assert.equal(discovered.ats_key, atsKey);
    assert.ok(source.parserVersion.startsWith(`source-${atsKey}-v`));
    assert.ok(sourceFamilies.includes(discovered.source_family));
    assert.ok(source.rateLimit().requestsPerMinute <= 8);
    assert.deepEqual(source.fixtures().map((fixturePath) => fixturePath.replace(/\\/g, "/")), [
      `server/ingestion/sources/${atsKey}/fixtures/company.json`,
      `server/ingestion/sources/${atsKey}/fixtures/list.json`,
      `server/ingestion/sources/${atsKey}/fixtures/expected-normalized.json`,
      `server/ingestion/sources/${atsKey}/fixtures/invalid-shapes.json`
    ]);

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
      assert.ok(row.evidence?.title?.present);
      assert.ok(row.evidence?.company?.present);
      assert.ok(row.evidence?.canonical_url?.present);
      assert.equal(row.source_job_id, expected.source_job_id);
      assert.equal(row.company_name, expected.company_name);
      assert.equal(row.position_name, expected.position_name);
      assert.equal(row.country, expected.country || "");
      if (Object.prototype.hasOwnProperty.call(expected, "city")) assert.equal(row.city, expected.city);
      assert.equal(row.remote_type, expected.remote_type || "unknown");
      assert.equal(row.canonical_url, expected.job_posting_url);
      assert.equal(row.source_evidence?.list_url, expected.source_evidence.list_url);
      assert.equal(row.source_evidence?.route_kind, expected.source_evidence.route_kind);
      assert.equal(row.parser_confidence, expected.parser_confidence);
      const gate = source.validatePublic(row);
      assert.equal(gate.status, expected.public_gate.status, `${atsKey} fixture should stay quarantined`);
      for (const reason of expected.public_gate.reason_codes) {
        assert.ok(gate.reason_codes.includes(reason), `${atsKey} gate should include ${reason}`);
      }
      for (const reason of reasonCodes) {
        assert.ok(gate.reason_codes.includes(reason), `${atsKey} gate should include ${reason}`);
      }
    }
  });

  test(`${atsKey} html/public source module rejects or quarantines invalid fixture shapes`, () => {
    const source = getSourceModule(atsKey);
    const sourceDir = path.join(__dirname, atsKey);
    const company = readJson(path.join(sourceDir, "fixtures", "company.json"));
    const invalid = readJson(path.join(sourceDir, "fixtures", "invalid-shapes.json"));

    for (const item of invalid.cases) {
      const normalized = source.normalize(item.posting, company);
      const basic = source.validate(normalized);
      const gate = source.validatePublic(normalized);
      if (item.expected === "rejected") {
        assert.equal(basic.ok, false, `${atsKey} ${item.name} should fail source validation`);
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
  for (const atsKey of ["applitrack", "applytojob", "breezy", "teamtailor", "freshteam"]) {
    const source = getSourceModule(atsKey);
    const company = readJson(path.join(__dirname, atsKey, "fixtures", "company.json"));
    assert.deepEqual(source.parse({ html: "" }, company), [], atsKey);
  }
});

test("hirebridge source module fetches list plus detail pages, enriches posting dates, and filters rows missing detail dates", async () => {
  const source = getSourceModule("hirebridge");
  assert.ok(source, "expected HireBridge source module");
  const company = readJson(path.join(__dirname, "hirebridge", "fixtures", "company.json"));
  const fixture = readJson(path.join(__dirname, "hirebridge", "fixtures", "detail-pages.json"));
  const requests = [];

  const payload = await source.fetchList(company, {
    fetcher: async (url, target) => {
      requests.push({ url, method: target.method, headers: target.headers });
      if (url === "https://recruit.hirebridge.com/v3/jobs/list.aspx?cid=1234") {
        return {
          status: 200,
          url,
          text: fixture.list_html
        };
      }
      if (url === "https://recruit.hirebridge.com/v3/CareerCenter/v2/details.aspx?cid=1234&jid=HB1001") {
        return {
          status: 200,
          url,
          text: fixture.detail_html_by_jid.HB1001
        };
      }
      if (url === "https://recruit.hirebridge.com/v3/CareerCenter/v2/details.aspx?cid=1234&jid=HB1002") {
        return {
          status: 200,
          url,
          text: fixture.detail_html_by_jid.HB1002
        };
      }
      return { status: 404, url, text: "" };
    }
  });

  assert.equal(payload.__sourceConfig.cid, "1234");
  assert.equal(payload.__sourceFetchFinalUrl, "https://recruit.hirebridge.com/v3/jobs/list.aspx?cid=1234");
  const detailRequests = requests.filter((request) => request.url.includes("/v3/CareerCenter/v2/details.aspx"));
  assert.equal(detailRequests.length, 2);

  const parsed = source.parse(payload, company);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].source_job_id, "HB1001");
  assert.equal(parsed[0].posting_date, "2026-05-18");
  assert.equal(parsed[0].location, "Chelsea, MA, United States");
  assert.equal(parsed[0].city, "Chelsea");
  assert.equal(parsed[0].country, "United States");
  assert.equal(parsed[0].employment_type, "Full Time");
  assert.equal(parsed[0].job_posting_url, "https://recruit.hirebridge.com/v3/Jobs/JobDetails.aspx?cid=1234&jid=HB1001");
  const normalized = source.normalize(parsed[0], company);
  assert.equal(normalized.country, "United States");
  assert.equal(normalized.region, "North America");
  assert.equal(normalized.city, "Chelsea");
  assert.equal(normalized.remote_type, "onsite");
  assert.equal(normalized.evidence.country.evidence_path, "script[type=\"application/ld+json\"].jobLocation.address");
});

test("hirebridge source module enforces recruit.hirebridge.com host guards for list and detail fetches", async () => {
  const source = getSourceModule("hirebridge");
  const company = readJson(path.join(__dirname, "hirebridge", "fixtures", "company.json"));

  await assert.rejects(
    () => source.fetchList(company, {
      fetcher: async () => ({
        status: 200,
        url: "https://example.com/list",
        text: "<ul></ul>"
      })
    }),
    /unexpected host/
  );

  await assert.rejects(
    () => source.fetchList(company, {
      fetcher: async (url) => {
        if (url.includes("/v3/jobs/list.aspx")) {
          return {
            status: 200,
            url,
            text: `<ul><li><a href="/v3/Jobs/JobDetails.aspx?cid=1234&jid=HB1001">Support Engineer</a></li></ul>`
          };
        }
        return {
          status: 200,
          url: "https://example.com/details",
          text: `<script type="application/ld+json">{"datePosted":"2026-05-18"}</script>`
        };
      }
    }),
    /unexpected host/
  );
});

test("freshteam source module fetches jobs HTML with source-local discovery and host guard", async () => {
  const source = getSourceModule("freshteam");
  assert.ok(source, "expected Freshteam source module");
  const company = readJson(path.join(__dirname, "freshteam", "fixtures", "company.json"));
  const rawList = readJson(path.join(__dirname, "freshteam", "fixtures", "list.json"));
  const calls = [];

  const payload = await source.fetchList(company, {
    fetcher: async (url, target) => {
      calls.push({ url, method: target.method, headers: target.headers });
      if (rawList.__detailHtmlByUrl?.[url]) {
        return {
          body: rawList.__detailHtmlByUrl[url],
          status: 200,
          url
        };
      }
      return {
        body: rawList.html,
        status: 200,
        url
      };
    }
  });

  assert.deepEqual(calls, [{
    url: "https://fixture.freshteam.com/jobs",
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  }]);
  assert.equal(payload.__sourceConfig.subdomainLower, "fixture");
  const parsed = source.parse(payload, company);
  assert.equal(parsed.length, 3);
  const normalized = parsed.map((posting) => source.normalize(posting, company));
  const byId = new Map(normalized.map((posting) => [posting.source_job_id, posting]));

  assert.equal(byId.get("3421-product-engineer").country, "Turkey");
  assert.equal(byId.get("3421-product-engineer").city, "Istanbul");
  assert.equal(byId.get("3421-product-engineer").remote_type, "onsite");
  assert.equal(source.validatePublic(byId.get("3421-product-engineer")).status, "accepted");
  assert.equal(byId.get("3422-remote-support-specialist").remote_type, "remote");
  assert.equal(source.validatePublic(byId.get("3422-remote-support-specialist")).status, "accepted");
  assert.equal(byId.get("ft_5003").canonical_url, "https://fixture.freshteam.com/jobs/ft_5003/customer-success-manager");
  assert.equal(byId.get("ft_5003").source_evidence.source_job_id_path, "/jobs/:source_id/:slug?");
  assert.equal(source.validatePublic(byId.get("ft_5003")).status, "accepted");

  await assert.rejects(
    () => source.fetchList(company, {
      fetcher: async () => ({
        body: rawList.html,
        status: 200,
        url: "https://example.com/jobs"
      })
    }),
    /unexpected host/
  );
});

test("teamtailor source module fetches jobs HTML with source-local discovery and host guard", async () => {
  const source = getSourceModule("teamtailor");
  assert.ok(source, "expected Teamtailor source module");
  const company = readJson(path.join(__dirname, "teamtailor", "fixtures", "company.json"));
  const rawList = readJson(path.join(__dirname, "teamtailor", "fixtures", "rss.json"));
  const calls = [];

  const payload = await source.fetchList(company, {
    fetcher: async (url, target) => {
      calls.push({ url, method: target.method, headers: target.headers });
      if (url === "https://fixture.teamtailor.com/jobs") {
        return {
          body: rawList.html,
          status: 200,
          url
        };
      }
      return {
        body: rawList.rss,
        status: 200,
        url
      };
    }
  });

  assert.deepEqual(calls, [
    {
      url: "https://fixture.teamtailor.com/jobs.rss",
      method: "GET",
      headers: {
        Accept: "application/rss+xml, text/xml, application/xml;q=0.9, */*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      }
    },
    {
      url: "https://fixture.teamtailor.com/jobs",
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      }
    }
  ]);
  assert.equal(payload.__sourceConfig.subdomainLower, "fixture");
  assert.equal(payload.__sourceConfig.rssUrl, "https://fixture.teamtailor.com/jobs.rss");
  assert.equal(payload.__sourceHtmlFetchFinalUrl, "https://fixture.teamtailor.com/jobs");
  const parsed = source.parse(payload, company);
  assert.equal(parsed.length, 4);
  const normalized = parsed.map((posting) => source.normalize(posting, company));
  const byId = new Map(normalized.map((posting) => [posting.source_job_id, posting]));

  assert.equal(byId.get("5842555-rss-support-engineer").country, "Germany");
  assert.equal(byId.get("5842555-rss-support-engineer").city, "Berlin");
  assert.equal(byId.get("5842555-rss-support-engineer").remote_type, "onsite");
  assert.equal(byId.get("5842555-rss-support-engineer").posting_date, "2026-03-20");
  assert.equal(source.validatePublic(byId.get("5842555-rss-support-engineer")).status, "accepted");
  assert.equal(byId.get("5842666-rss-remote-success-manager").remote_type, "remote");
  assert.equal(byId.get("5842777-rss-hybrid-consultant").country, "Sweden");
  assert.equal(byId.get("5842777-rss-hybrid-consultant").remote_type, "hybrid");
  assert.equal(source.validatePublic(byId.get("5842777-rss-hybrid-consultant")).status, "accepted");
  assert.equal(byId.get("5842888-rss-html-fallback-producer").country, "Sweden");
  assert.equal(byId.get("5842888-rss-html-fallback-producer").city, "Stockholm");
  assert.equal(byId.get("5842888-rss-html-fallback-producer").remote_type, "onsite");
  assert.equal(byId.get("5842888-rss-html-fallback-producer").posting_date, "2026-03-24");
  assert.equal(source.validatePublic(byId.get("5842888-rss-html-fallback-producer")).status, "accepted");

  await assert.rejects(
    () => source.fetchList(company, {
      fetcher: async () => ({
        body: rawList.rss,
        status: 200,
        url: "https://example.com/jobs"
      })
    }),
    /unexpected host/
  );
});

test("teamtailor source module enriches blank remote country from detail JSON-LD", async () => {
  const source = getSourceModule("teamtailor");
  const company = readJson(path.join(__dirname, "teamtailor", "fixtures", "company.json"));
  const detailUrl = "https://fixture.teamtailor.com/jobs/7737740-data-engineer";
  const calls = [];
  const payload = await source.fetchList(company, {
    fetcher: async (url, target) => {
      calls.push({ url, method: target.method });
      if (url === "https://fixture.teamtailor.com/jobs.rss") {
        return {
          body: [
            `<?xml version="1.0" encoding="UTF-8"?>`,
            `<rss version="2.0" xmlns:tt="https://teamtailor.com/locations"><channel>`,
            `<item>`,
            `<title>Data Engineer</title>`,
            `<link>${detailUrl}</link>`,
            `<guid>teamtailor-rss-guid-detail-country</guid>`,
            `<pubDate>Thu, 14 May 2026 15:21:34 +0200</pubDate>`,
            `<remoteStatus>fully</remoteStatus>`,
            `<tt:department>Software Development</tt:department>`,
            `<tt:locations></tt:locations>`,
            `</item>`,
            `</channel></rss>`
          ].join(""),
          status: 200,
          url
        };
      }
      if (url === "https://fixture.teamtailor.com/jobs") {
        return {
          body: [
            `<ul><li class="w-full">`,
            `<a class="line-clamp-2 flex" href="${detailUrl}">Data Engineer</a>`,
            `<div class="mt-1 text-md"><span>Software Development</span></div>`,
            `</li></ul>`
          ].join(""),
          status: 200,
          url
        };
      }
      if (url === detailUrl) {
        return {
          body: [
            `<script type="application/ld+json">`,
            `{"@context":"http://schema.org/","@type":"JobPosting","title":"Data Engineer",`,
            `"datePosted":"2026-05-14T15:21:34+02:00","jobLocationType":"TELECOMMUTE",`,
            `"applicantLocationRequirements":{"@type":"Country","name":"Poland"},`,
            `"jobLocation":[{"@type":"Place","address":{}}]}`,
            `</script>`
          ].join(""),
          status: 200,
          url
        };
      }
      return { body: "", status: 404, url };
    }
  });

  assert.deepEqual(calls, [
    { url: "https://fixture.teamtailor.com/jobs.rss", method: "GET" },
    { url: "https://fixture.teamtailor.com/jobs", method: "GET" },
    { url: detailUrl, method: "GET" }
  ]);
  assert.equal(payload.__sourceConfig.detail_fetch_count, 1);
  const parsed = source.parse(payload, company);
  assert.equal(parsed.length, 1);
  const normalized = source.normalize(parsed[0], company);

  assert.equal(normalized.source_job_id, "7737740-data-engineer");
  assert.equal(normalized.country, "Poland");
  assert.equal(normalized.region, "EMEA");
  assert.equal(normalized.remote_type, "remote");
  assert.equal(normalized.posting_date, "2026-05-14");
  assert.equal(normalized.source_evidence.country_source, "json_ld");
  assert.equal(normalized.source_evidence.country_path, "script[type='application/ld+json'].applicantLocationRequirements.name");
  assert.equal(normalized.source_evidence.detail_fetch_status, 200);
  assert.equal(source.validatePublic(normalized).status, "accepted");
});

test("teamtailor RSS/HTML merge keeps unhinted brand labels quarantined", () => {
  const source = getSourceModule("teamtailor");
  const company = readJson(path.join(__dirname, "teamtailor", "fixtures", "company.json"));
  const payload = {
    rss: [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<rss version="2.0" xmlns:tt="https://teamtailor.com/locations"><channel>`,
      `<item>`,
      `<title>Brand Label Role</title>`,
      `<link>https://fixture.teamtailor.com/jobs/5842999-brand-label-role</link>`,
      `<guid>teamtailor-rss-guid-brand</guid>`,
      `<remoteStatus>none</remoteStatus>`,
      `<tt:locations></tt:locations>`,
      `</item>`,
      `</channel></rss>`
    ].join(""),
    html: [
      `<ul><li class="w-full">`,
      `<div class="relative flex">`,
      `<a class="line-clamp-2 flex" href="https://fixture.teamtailor.com/jobs/5842999-brand-label-role">`,
      `<span class="absolute inset-0"></span>Brand Label Role</a>`,
      `<div class="mt-1 text-md"><span>Fixture Teamtailor</span></div>`,
      `</div>`,
      `</li></ul>`
    ].join(""),
    __sourceConfig: {
      baseOrigin: "https://fixture.teamtailor.com",
      jobsUrl: "https://fixture.teamtailor.com/jobs",
      rssUrl: "https://fixture.teamtailor.com/jobs.rss"
    }
  };

  const parsed = source.parse(payload, company);
  assert.equal(parsed.length, 1);
  const normalized = source.normalize(parsed[0], company);
  assert.equal(normalized.location_text || "", "");
  assert.equal(normalized.country, "");
  assert.equal(source.validatePublic(normalized).status, "quarantined");
  assert.ok(source.validatePublic(normalized).reason_codes.includes("no_geo_no_remote"));
});

test("jobvite source module fetches jobs HTML with source-local discovery and host guard", async () => {
  const source = getSourceModule("jobvite");
  assert.ok(source, "expected Jobvite source module");
  const company = readJson(path.join(__dirname, "jobvite", "fixtures", "company.json"));
  const rawList = readJson(path.join(__dirname, "jobvite", "fixtures", "list.json"));
  const calls = [];

  const payload = await source.fetchList(company, {
    fetcher: async (url, target) => {
      calls.push({ url, method: target.method, headers: target.headers });
      const detailHtml = rawList.__detailHtmlByUrl?.[url];
      return {
        body: detailHtml || rawList.html,
        status: 200,
        url
      };
    }
  });

  assert.deepEqual(calls, [{
    url: "https://jobs.jobvite.com/fixture/jobs",
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  }, {
    url: "https://jobs.jobvite.com/fixture/job/oMULTIxfw6",
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  }, {
    url: "https://jobs.jobvite.com/fixture/job/oPHLxfw5",
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  }, {
    url: "https://jobs.jobvite.com/fixture/job/oAUSxfw7",
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  }, {
    url: "https://jobs.jobvite.com/fixture/job/oABCxfw9",
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  }, {
    url: "https://jobs.jobvite.com/fixture/job/oDEFxfw8",
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  }]);
  assert.equal(payload.__sourceConfig.companySlugLower, "fixture");
  assert.equal(payload.__sourceConfig.detail_fetch_count, 5);
  const parsed = source.parse(payload, company);
  assert.equal(parsed.length, 5);
  const normalized = parsed.map((posting) => source.normalize(posting, company));
  const byId = new Map(normalized.map((posting) => [posting.source_job_id, posting]));

  assert.equal(byId.get("oABCxfw9").country, "Turkey");
  assert.equal(byId.get("oABCxfw9").city, "Istanbul");
  assert.equal(byId.get("oABCxfw9").remote_type, "onsite");
  assert.equal(byId.get("oABCxfw9").posting_date, "2026-05-01");
  assert.equal(source.validatePublic(byId.get("oABCxfw9")).status, "accepted");
  assert.equal(byId.get("oDEFxfw8").remote_type, "remote");
  assert.equal(byId.get("oDEFxfw8").country, "United States");
  assert.equal(byId.get("oDEFxfw8").posting_date, "2026-05-02");
  assert.equal(source.validatePublic(byId.get("oDEFxfw8")).status, "accepted");
  assert.equal(byId.get("oPHLxfw5").country, "Philippines");
  assert.equal(byId.get("oPHLxfw5").city, "Cabuyao");
  assert.equal(byId.get("oPHLxfw5").posting_date, "2026-05-06");
  assert.equal(byId.get("oPHLxfw5").evidence.country.evidence_path, "script[type='application/ld+json'].jobLocation[].address.addressRegion");
  assert.equal(byId.get("oPHLxfw5").evidence.country.rule_name, "jobvite_json_ld_region_country_hint");
  assert.equal(source.validatePublic(byId.get("oPHLxfw5")).status, "accepted");
  assert.equal(byId.get("oAUSxfw7").country, "Australia");
  assert.equal(byId.get("oAUSxfw7").city, "Sydney");
  assert.equal(byId.get("oAUSxfw7").evidence.country.evidence_path, "script[type='application/ld+json'].jobLocation[].address.addressCountry");
  assert.equal(source.validatePublic(byId.get("oAUSxfw7")).status, "accepted");
  assert.equal(byId.get("oMULTIxfw6").location_text, "Tacoma, Washington, United States / Lakewood, Washington, United States");
  assert.equal(byId.get("oMULTIxfw6").country, "United States");
  assert.equal(byId.get("oMULTIxfw6").city, "Tacoma");
  assert.equal(source.validatePublic(byId.get("oMULTIxfw6")).status, "accepted");

  await assert.rejects(
    () => source.fetchList(company, {
      fetcher: async () => ({
        body: rawList.html,
        status: 200,
        url: "https://example.com/fixture/jobs"
      })
    }),
    /unexpected host/
  );
});

test("jobvite source module does not publish numeric multi-location labels as geo", () => {
  const source = getSourceModule("jobvite");
  const company = readJson(path.join(__dirname, "jobvite", "fixtures", "company.json"));
  const payload = {
    html: "<h3>Operations</h3><table class=\"jv-job-list\"><tr><td class=\"jv-job-list-name\"><a href=\"/fixture/job/oAMBIGzfw1\">Ambiguous Role</a></td><td class=\"jv-job-list-location\">2 Locations</td></tr><tr><td class=\"jv-job-list-name\"><a href=\"/fixture/job/oREMOTEzfw2\">Remote Role</a></td><td class=\"jv-job-list-location\">Remote, 18 Locations</td></tr><tr><td class=\"jv-job-list-name\"><a href=\"/fixture/job/oPORTUGAL3\">Store Role</a></td><td class=\"jv-job-list-location\">Vila Nova de Famalicão</td></tr></table>",
    __detailHtmlByUrl: {
      "https://jobs.jobvite.com/fixture/job/oAMBIGzfw1": "<script type=\"application/ld+json\">{\"@context\":\"http://schema.org\",\"@type\":\"JobPosting\",\"title\":\"Ambiguous Role\",\"datePosted\":\"2026-05-04\"}</script>",
      "https://jobs.jobvite.com/fixture/job/oREMOTEzfw2": "<script type=\"application/ld+json\">{\"@context\":\"http://schema.org\",\"@type\":\"JobPosting\",\"title\":\"Remote Role\",\"datePosted\":\"2026-05-05\"}</script>"
    },
    __sourceConfig: {
      baseOrigin: "https://jobs.jobvite.com",
      companySlugLower: "fixture"
    }
  };

  const normalized = source.parse(payload, company).map((posting) => source.normalize(posting, company));
  const byId = new Map(normalized.map((posting) => [posting.source_job_id, posting]));

  assert.ok(!byId.get("oAMBIGzfw1").location_text);
  assert.equal(byId.get("oAMBIGzfw1").posting_date, "2026-05-04");
  const ambiguousGate = source.validatePublic(byId.get("oAMBIGzfw1"));
  assert.equal(ambiguousGate.status, "quarantined");
  assert.ok(ambiguousGate.reason_codes.includes("no_geo_no_remote"));

  assert.equal(byId.get("oREMOTEzfw2").location_text, "Remote");
  assert.equal(byId.get("oREMOTEzfw2").remote_type, "remote");
  assert.equal(byId.get("oREMOTEzfw2").posting_date, "2026-05-05");
  assert.equal(source.validatePublic(byId.get("oREMOTEzfw2")).status, "accepted");

  assert.equal(byId.get("oPORTUGAL3").country, "Portugal");
  assert.equal(byId.get("oPORTUGAL3").city, "Vila Nova de Famalicão");
  assert.equal(byId.get("oPORTUGAL3").evidence.country.evidence_path, "table.jv-job-list td.jv-job-list-location");
  assert.equal(byId.get("oPORTUGAL3").evidence.country.rule_name, "jobvite_list_location_country_hint");
  assert.equal(source.validatePublic(byId.get("oPORTUGAL3")).status, "accepted");
});

test("join source module fetches Next.js company page with source-local host guard", async () => {
  const source = getSourceModule("join");
  const company = readJson(path.join(__dirname, "join", "fixtures", "company.json"));
  const rawList = readJson(path.join(__dirname, "join", "fixtures", "list.json"));
  const calls = [];

  const payload = await source.fetchList(company, {
    fetcher: async (url, target) => {
      calls.push({ url, method: target.method, headers: target.headers });
      return {
        body: rawList.html,
        status: 200,
        url
      };
    }
  });

  assert.deepEqual(calls, [{
    url: "https://join.com/companies/fixtureco",
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  }]);
  assert.equal(payload.__sourceConfig.companySlug, "fixtureco");
  const parsed = source.parse(payload, company);
  assert.equal(parsed.length, 3);
  const normalized = parsed.map((posting) => source.normalize(posting, company));
  const byId = new Map(normalized.map((posting) => [posting.source_job_id, posting]));
  assert.equal(byId.get("fixture-remote-role").country, "Germany");
  assert.equal(byId.get("fixture-remote-role").remote_type, "hybrid");
  assert.equal(byId.get("fixture-bangladesh-role").country, "Bangladesh");
  assert.equal(byId.get("fixture-bangladesh-role").region, "APAC");
  assert.equal(byId.get("fixture-bangladesh-role").city, "Dhaka");
  assert.equal(byId.get("fixture-bangladesh-role").remote_type, "onsite");
  assert.equal(byId.get("fixture-kosovo-role").country, "Kosovo");
  assert.equal(byId.get("fixture-kosovo-role").region, "EMEA");
  assert.equal(byId.get("fixture-kosovo-role").city, "Pristina");
  assert.equal(byId.get("fixture-kosovo-role").remote_type, "hybrid");
  assert.equal(source.validatePublic(byId.get("fixture-kosovo-role")).status, "accepted");

  await assert.rejects(
    () => source.fetchList(company, {
      fetcher: async () => ({
        body: rawList.html,
        status: 200,
        url: "https://example.com/companies/fixtureco"
      })
    }),
    /unexpected host/
  );
});

test("applicantpro source module discovers domain id and fetches core jobs JSON", async () => {
  const source = getSourceModule("applicantpro");
  assert.ok(source, "expected ApplicantPro source module");
  const company = {
    company_name: "Fixture ApplicantPro",
    ATS_name: "applicantpro",
    url_string: "https://fixtureco.applicantpro.com/jobs/"
  };
  const requestedUrls = [];

  const raw = await source.fetchList(company, {
    fetcher: async (url) => {
      requestedUrls.push(url);
      if (url === "https://fixtureco.applicantpro.com/jobs/") {
        return {
          html: `<html><script>window.courierCurrentRouteData={"domain_id":"12345"}</script></html>`,
          status: 200,
          url
        };
      }
      if (url === "https://fixtureco.applicantpro.com/core/jobs/12345?getParams=%7B%7D") {
        return {
          data: {
            jobs: [{
              id: 445566,
              title: "Remote Support Specialist",
              jobUrl: "/jobs/445566",
              jobLocation: "Remote - United States",
              startDateRef: "2026-05-24",
              department: "Operations",
              employmentType: "Full-time"
            }]
          },
          success: true
        };
      }
      return { status: 404, html: "", url };
    }
  });

  assert.deepEqual(requestedUrls, [
    "https://fixtureco.applicantpro.com/jobs/",
    "https://fixtureco.applicantpro.com/core/jobs/12345?getParams=%7B%7D"
  ]);
  const parsed = source.parse(raw, company);
  assert.equal(parsed.length, 1);
  const normalized = source.normalize(parsed[0], company);
  assert.equal(normalized.source_job_id, "445566");
  assert.equal(normalized.company_name, "Fixture ApplicantPro");
  assert.equal(normalized.position_name, "Remote Support Specialist");
  assert.equal(normalized.canonical_url, "https://fixtureco.applicantpro.com/jobs/445566");
  assert.equal(normalized.country, "United States");
  assert.equal(normalized.remote_type, "remote");
  assert.equal(normalized.posting_date, "2026-05-24");
  assert.equal(source.validate(normalized).ok, true);
  assert.equal(evaluatePublicPosting(normalized, { parserVersion: source.parserVersion }).status, "accepted");
});

test("careerplug source module enriches list rows from deterministic detail JSON-LD", async () => {
  const source = getSourceModule("careerplug");
  const fixture = readJson(path.join(__dirname, "careerplug", "fixtures", "route-detection.json"));
  const requestedUrls = [];
  const raw = await source.fetchList(fixture.company, {
    maxCareerplugDetailFetches: 5,
    fetcher: async (url) => {
      requestedUrls.push(url);
      if (url === "https://fixture.careerplug.com/jobs") return { html: fixture.list_html, status: 200, url };
      const jobId = new URL(url).pathname.split("/").filter(Boolean).pop();
      if (fixture.details[jobId]) return { html: fixture.details[jobId], status: 200, url };
      return { html: "", status: 404, url };
    }
  });

  assert.ok(requestedUrls.includes("https://fixture.careerplug.com/jobs/3301618"));
  const parsed = source.parse(raw, fixture.company);
  assert.equal(parsed.length, 1);
  const normalized = source.normalize(parsed[0], fixture.company);
  const expected = fixture.expected["3301618"];

  assert.equal(normalized.source_job_id, "3301618");
  assert.equal(normalized.location_text, expected.location_text);
  assert.equal(normalized.country, expected.country);
  assert.equal(normalized.city, expected.city);
  assert.equal(normalized.remote_type, expected.remote_type);
  assert.equal(normalized.posting_date, expected.posting_date);
  assert.equal(normalized.source_evidence.location_source, expected.location_source);
  assert.equal(normalized.source_evidence.posting_date_source, expected.posting_date_source);
  assert.equal(evaluatePublicPosting(normalized, { parserVersion: source.parserVersion }).status, "accepted");
});

test("careerplug source module preserves source-local dashed list location evidence", () => {
  const source = getSourceModule("careerplug");
  const sourceDir = path.join(__dirname, "careerplug");
  const company = readJson(path.join(sourceDir, "fixtures", "company.json"));
  const rawList = readJson(path.join(sourceDir, "fixtures", "list.json"));
  const parsed = source.parse(rawList, company);
  const normalized = parsed.map((posting) => source.normalize(posting, company));
  const byId = Object.fromEntries(normalized.map((posting) => [posting.source_job_id, posting]));

  assert.equal(byId["3001"].location_text, "Huntersville, NC, United States");
  assert.equal(byId["3001"].country, "United States");
  assert.equal(byId["3001"].city, "Huntersville");
  assert.equal(byId["3001"].remote_type, "onsite");
  assert.equal(byId["3001"].source_evidence.location_path, ".job-location");
  assert.equal(byId["3001"].source_evidence.location_rule_name, "careerplug_us_city_state_location");
  assert.equal(byId["3001"].source_evidence.remote_rule_name, "careerplug_structured_physical_location");

  assert.equal(byId["3002"].location_text, "Maple Grove, MN, United States");
  assert.equal(byId["3002"].remote_type, "hybrid");
  assert.equal(byId["3002"].source_evidence.remote_path, ".job-location");
  assert.equal(byId["3002"].source_evidence.remote_rule_name, "careerplug_labeled_location_work_mode");

  assert.equal(byId["3003"].location_text, "San Juan, PR, Puerto Rico");
  assert.equal(byId["3003"].country, "Puerto Rico");
  assert.equal(byId["3003"].source_evidence.country_rule_name, "careerplug_pr_city_zip_location");

  assert.equal(byId["3004"].location_text, "Etobicoke, ON, Canada");
  assert.equal(byId["3004"].country, "Canada");
  assert.equal(byId["3004"].source_evidence.country_rule_name, "careerplug_canada_city_province_location");

  assert.equal(byId["3005"].location_text, "Ada, OK, United States");
  assert.equal(byId["3005"].city, "Ada");
  assert.equal(byId["3005"].remote_type, "hybrid");
  assert.equal(byId["3005"].source_evidence.location_rule_name, "careerplug_state_city_zip_location");
  assert.equal(byId["3005"].source_evidence.remote_rule_name, "careerplug_labeled_location_work_mode");

  assert.equal(byId["3006"].location_text, "Edmonton, AB, Canada");
  assert.equal(byId["3006"].city, "Edmonton");
  assert.equal(byId["3006"].country, "Canada");
  assert.equal(byId["3006"].source_evidence.location_rule_name, "careerplug_province_city_postal_location");

  for (const id of ["3001", "3002", "3003", "3004", "3005", "3006"]) {
    assert.equal(evaluatePublicPosting(byId[id], { parserVersion: source.parserVersion }).status, "accepted");
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

test("applitrack source module fetches Output.asp and details with source-local request metadata", async () => {
  const source = getSourceModule("applitrack");
  const sourceDir = path.join(__dirname, "applitrack");
  const fixture = readJson(path.join(sourceDir, "fixtures", "route-detection.json"));
  const requests = [];

  const raw = await source.fetchList(fixture.company, {
    maxApplitrackDetailFetches: 2,
    fetcher: async (url, target) => {
      requests.push({ url, method: target.method, headers: target.headers });
      const value = String(url || "");
      if (/Output\.asp/i.test(value)) return { html: fixture.output_html, status: 200, url: value };
      const parsed = new URL(value);
      const jobId = parsed.searchParams.get("AppliTrackJobId");
      if (fixture.details[jobId]) return { html: fixture.details[jobId], status: 200, url: value };
      return { html: "", status: fixture.stale_detail_status, url: value };
    }
  });

  assert.equal(raw.__sourceConfig.siteRoot, "https://www.applitrack.com/fixturedistrict/onlineapp/");
  assert.deepEqual(requests.slice(0, 3), [
    {
      url: "https://www.applitrack.com/fixturedistrict/onlineapp/jobpostings/Output.asp?all=1",
      method: "GET",
      headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }
    },
    {
      url: "https://www.applitrack.com/fixturedistrict/onlineapp/JobPostings/view.asp?AppliTrackJobId=7001&AppliTrackLayoutMode=detail&AppliTrackViewPosting=1&all=1&embed=1",
      method: "GET",
      headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }
    },
    {
      url: "https://www.applitrack.com/fixturedistrict/onlineapp/JobPostings/view.asp?AppliTrackJobId=7003&AppliTrackLayoutMode=detail&AppliTrackViewPosting=1&all=1&embed=1",
      method: "GET",
      headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }
    }
  ]);
  assert.equal(raw.__sourceConfig.detail_fetch_count, 2);
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

test("applytojob source fetch honors bounded detail override for rows missing geo evidence", async () => {
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
                <li class="list-group-item">
                  <h3 class="list-group-item-heading"><a href="/apply/ATJ-NEEDS-2/Field-Coordinator">Field Coordinator</a></h3>
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
        if (value.includes("/ATJ-NEEDS-2/")) {
          return {
            status: 200,
            url: value,
            html: `
              <script type="application/ld+json">
                {
                  "@context": "https://schema.org",
                  "@type": "JobPosting",
                  "title": "Field Coordinator",
                  "datePosted": "2026-05-14",
                  "jobLocation": {
                    "@type": "Place",
                    "address": {
                      "@type": "PostalAddress",
                      "addressLocality": "Nairobi",
                      "addressCountry": "KE"
                    }
                  }
                }
              </script>
            `
          };
        }
        return { status: 200, url: value, html: "<html></html>" };
      },
      maxApplyToJobDetailPages: 2
    });
    const parsed = source.parse(raw, company);
    const normalized = parsed.map((posting) => source.normalize(posting, company));
    const byId = Object.fromEntries(normalized.map((posting) => [posting.source_job_id, posting]));

    assert.ok(fetchedUrls.some((url) => url.includes("/ATJ-NEEDS/")));
    assert.ok(fetchedUrls.some((url) => url.includes("/ATJ-NEEDS-2/")));
    assert.equal(raw.__sourceConfig.detail_fetch_count, 2);
    assert.equal(byId["ATJ-NEEDS"].country, "Philippines");
    assert.equal(byId["ATJ-NEEDS"].city, "Iloilo City");
    assert.equal(evaluatePublicPosting(byId["ATJ-NEEDS"], { parserVersion: source.parserVersion }).status, "accepted");
    assert.equal(byId["ATJ-NEEDS-2"].country, "Kenya");
    assert.equal(byId["ATJ-NEEDS-2"].city, "Nairobi");
    assert.equal(evaluatePublicPosting(byId["ATJ-NEEDS-2"], { parserVersion: source.parserVersion }).status, "accepted");
  } finally {
    if (previousLimit === undefined) {
      delete process.env.OPENJOBSLOTS_APPLYTOJOB_DETAIL_FETCH_LIMIT_PER_COMPANY;
    } else {
      process.env.OPENJOBSLOTS_APPLYTOJOB_DETAIL_FETCH_LIMIT_PER_COMPANY = previousLimit;
    }
  }
});

test("applytojob source module preserves list country when detail JSON-LD omits country", () => {
  const source = getSourceModule("applytojob");
  const company = readJson(path.join(__dirname, "applytojob", "fixtures", "company.json"));
  const detailUrl = "https://fixture.applytojob.com/apply/ATJ6001/Payments-Specialist";
  const parsed = source.parse({
    html: `
      <section class="jobs">
        <article class="job-card">
          <a class="job-title" href="/apply/ATJ6001/Payments-Specialist">Payments Specialist</a>
          <div><span>Location:</span><span>BGC, Taguig City, Philippines</span></div>
        </article>
      </section>
    `,
    __listUrl: company.url_string,
    __detailHtmlByUrl: {
      [detailUrl]: `
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "JobPosting",
            "title": "Payments Specialist",
            "datePosted": "2026-05-31",
            "jobLocation": {
              "@type": "Place",
              "address": {
                "@type": "PostalAddress",
                "addressLocality": "BGC, Taguig City",
                "addressRegion": "Metro Manila"
              }
            }
          }
        </script>
      `
    }
  }, company);
  assert.equal(parsed.length, 1);
  const normalized = source.normalize(parsed[0], company);
  assert.equal(normalized.country, "Philippines");
  assert.equal(normalized.city, "BGC, Taguig City");
  assert.equal(normalized.posting_date, "2026-05-31");
  assert.equal(normalized.source_evidence.location_source, "labeled_html");
  assert.equal(normalized.source_evidence.country_source, "labeled_html");
  assert.equal(normalized.source_evidence.city_source, "json_ld");
  assert.equal(evaluatePublicPosting(normalized, { parserVersion: source.parserVersion }).status, "accepted");
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

test("applytojob source module parses Resumator table location cells", () => {
  const source = getSourceModule("applytojob");
  const company = readJson(path.join(__dirname, "applytojob", "fixtures", "company.json"));
  const parsed = source.parse({
    html: `
      <table class="resumator-job-listings">
        <tbody>
          <tr class="resumator-table-row-even">
            <td class="resumator-job-title-column">
              <a href="https://fixture.applytojob.com/apply/ATJ5001/1099-Field-Occupancy-Evaluator" class="resumator-job-title-link">1099 Field Occupancy Evaluator</a>
            </td>
            <td class="resumator-department-column"><span class="resumator-table-no-department">(none)</span></td>
            <td class="resumator-job-location-column">Houston, MS</td>
          </tr>
        </tbody>
      </table>
    `,
    __listUrl: company.url_string
  }, company);
  assert.equal(parsed.length, 1);
  const normalized = source.normalize(parsed[0], company);
  assert.equal(normalized.source_job_id, "ATJ5001");
  assert.equal(normalized.position_name, "1099 Field Occupancy Evaluator");
  assert.equal(normalized.location_text, "Houston, MS");
  assert.equal(normalized.country, "United States");
  assert.equal(normalized.city, "Houston");
  assert.equal(normalized.source_evidence.route_kind, "applytojob_legacy_list_html");
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
        <article class="job-card">
          <a class="job-title" href="/apply/ATJ4005/Sydney-Analyst">Sydney Analyst</a>
          <div><span>Location:</span><span>Sydney, New South Wales</span></div>
        </article>
        <article class="job-card">
          <a class="job-title" href="/apply/ATJ4006/Product-Manager">Product Manager</a>
          <div><span>Location:</span><span>Sydney, New South Wales, Australia</span></div>
        </article>
        <article class="job-card">
          <a class="job-title" href="/apply/ATJ4007/Fraud-Analyst">Fraud Analyst</a>
          <div><span>Location:</span><span>Ikeja, Lagos</span></div>
        </article>
        <article class="job-card">
          <a class="job-title" href="/apply/ATJ4008/Dealer-Manager">Dealer Manager</a>
          <div><span>Location:</span><span>Lagos, Lagos State</span></div>
        </article>
        <article class="job-card">
          <a class="job-title" href="/apply/ATJ4009/Compliance-Manager">Compliance Manager</a>
          <div><span>Location:</span><span>Ouagadougou, Burkina Faso</span></div>
        </article>
        <article class="job-card">
          <a class="job-title" href="/apply/ATJ4010/Admin-Specialist">Admin Specialist</a>
          <div><span>Location:</span><span>Ouagadougou, Ouagadougou</span></div>
        </article>
      </section>
    `,
    __listUrl: company.url_string
  }, company);
  assert.equal(parsed.length, 10);
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

  assert.equal(normalized.ATJ4005.country, "Australia");
  assert.equal(normalized.ATJ4005.region, "APAC");
  assert.equal(normalized.ATJ4005.city, "Sydney");
  assert.equal(normalized.ATJ4005.source_evidence.location_rule_name, "applytojob_country_token_hint");

  assert.equal(normalized.ATJ4006.country, "Australia");
  assert.equal(normalized.ATJ4006.region, "APAC");
  assert.equal(normalized.ATJ4006.city, "Sydney");
  assert.equal(normalized.ATJ4006.source_evidence.location_rule_name, "applytojob_country_token_hint");

  assert.equal(normalized.ATJ4007.country, "Nigeria");
  assert.equal(normalized.ATJ4007.region, "EMEA");
  assert.equal(normalized.ATJ4007.city, "Ikeja");
  assert.equal(normalized.ATJ4007.source_evidence.location_rule_name, "applytojob_country_token_hint");

  assert.equal(normalized.ATJ4008.country, "Nigeria");
  assert.equal(normalized.ATJ4008.region, "EMEA");
  assert.equal(normalized.ATJ4008.city, "Lagos");
  assert.equal(normalized.ATJ4008.source_evidence.location_rule_name, "applytojob_country_token_hint");

  assert.equal(normalized.ATJ4009.country, "Burkina Faso");
  assert.equal(normalized.ATJ4009.region, "EMEA");
  assert.equal(normalized.ATJ4009.city, "Ouagadougou");
  assert.equal(normalized.ATJ4009.source_evidence.location_rule_name, "applytojob_country_token_hint");

  assert.equal(normalized.ATJ4010.country, "Burkina Faso");
  assert.equal(normalized.ATJ4010.region, "EMEA");
  assert.equal(normalized.ATJ4010.city, "Ouagadougou");
  assert.equal(normalized.ATJ4010.source_evidence.location_rule_name, "applytojob_country_token_hint");
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

test("breezy source module prefers public JSON locations over ambiguous portal text", async () => {
  const source = getSourceModule("breezy");
  const company = {
    company_name: "Fixture Breezy JSON",
    ATS_name: "breezy",
    url_string: "https://fixture-json.breezy.hr/"
  };
  const raw = await source.fetchList(company, {
    fetcher: async (url) => {
      const value = String(url || "");
      if (value === "https://fixture-json.breezy.hr/") {
        return {
          html: `<div class="positions">
            <a href="/p/brz-json-sales-representative"><h2>Sales Representative</h2>
              <ul class="meta"><li class="location"><span class="polygot">%LABEL_MULTIPLE_LOCATIONS%</span><span> (5) </span></li></ul>
            </a>
          </div>`,
          status: 200,
          url: value
        };
      }
      if (value === "https://fixture-json.breezy.hr/json") {
        return {
          html: JSON.stringify([{
            id: "brz-json",
            name: "Sales Representative",
            url: "https://fixture-json.breezy.hr/p/brz-json-sales-representative",
            published_date: "2026-05-21T10:00:00.000Z",
            type: { name: "Full-Time" },
            location: {
              city: "Dunkirk",
              state: { id: "MD", name: "Maryland" },
              country: { id: "US", name: "United States" },
              name: "Dunkirk, MD",
              is_remote: false
            }
          }]),
          status: 200,
          url: value
        };
      }
      return { html: "", status: 404, url: value };
    }
  });
  const parsed = source.parse(raw, company);
  assert.equal(parsed.length, 1);
  const normalized = source.normalize(parsed[0], company);
  assert.equal(normalized.source_job_id, "brz-json");
  assert.equal(normalized.location_text, "Dunkirk, MD, United States");
  assert.equal(normalized.country, "United States");
  assert.equal(normalized.city, "Dunkirk");
  assert.equal(normalized.remote_type, "onsite");
  assert.equal(normalized.source_evidence.remote_source, "json_api");
  assert.equal(normalized.source_evidence.route_kind, "breezy_public_json");
  assert.deepEqual(normalized.source_failure_reasons || [], []);
  assert.equal(evaluatePublicPosting(normalized, { parserVersion: source.parserVersion }).status, "accepted");
});

test("breezy source module normalizes explicit country payload tokens", () => {
  const source = getSourceModule("breezy");
  const company = {
    company_name: "Fixture Breezy Country Tokens",
    ATS_name: "breezy",
    url_string: "https://fixture-country.breezy.hr/"
  };
  const rows = [
    ["brz-bermuda", "Actuarial Manager", "Hamilton", "Bermuda"],
    ["brz-bvi", "Trust Officer", "Road Town", "Virgin Islands, British"],
    ["brz-togo", "Operations Manager", "Lome", "Togo"],
    ["brz-cameroon", "Finance Lead", "Yaounde", "Cameroun"],
    ["brz-china", "Support Analyst", "Dalian", "中国"]
  ].map(([id, name, city, country]) => ({
    id,
    name,
    url: `https://fixture-country.breezy.hr/p/${id}`,
    published_date: "2026-05-22T10:00:00.000Z",
    location: {
      city,
      country: { name: country },
      name: `${city}, ${country}`,
      is_remote: false
    }
  }));
  const parsed = source.parse({
    html: "",
    __listUrl: "https://fixture-country.breezy.hr/",
    __json: rows
  }, company);
  const normalized = Object.fromEntries(parsed.map((posting) => {
    const row = source.normalize(posting, company);
    return [row.source_job_id, row];
  }));

  assert.equal(normalized["brz-bermuda"].country, "Bermuda");
  assert.equal(normalized["brz-bermuda"].region, "North America");
  assert.equal(normalized["brz-bvi"].country, "British Virgin Islands");
  assert.equal(normalized["brz-bvi"].region, "North America");
  assert.equal(normalized["brz-togo"].country, "Togo");
  assert.equal(normalized["brz-togo"].region, "EMEA");
  assert.equal(normalized["brz-cameroon"].country, "Cameroon");
  assert.equal(normalized["brz-cameroon"].region, "EMEA");
  assert.equal(normalized["brz-china"].country, "China");
  assert.equal(normalized["brz-china"].region, "APAC");
  for (const row of Object.values(normalized)) {
    assert.equal(row.source_evidence.country_source, "json_api");
    assert.deepEqual(row.source_failure_reasons || [], []);
    assert.equal(evaluatePublicPosting(row, { parserVersion: source.parserVersion }).status, "accepted");
  }
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

test("hrmdirect source module skips duplicate grouped Read More links", async () => {
  const source = getSourceModule("hrmdirect");
  const company = {
    company_name: "Fixture HRMDirect Grouped Read More",
    ATS_name: "hrmdirect",
    url_string: "https://groupedreadmore.hrmdirect.com/employment/job-openings.php"
  };
  const listUrl = "https://groupedreadmore.hrmdirect.com/employment/job-openings.php?search=true";
  const detailWithReqLoc = "https://groupedreadmore.hrmdirect.com/employment/job-opening.php?req=HRM3101&req_loc=5001";
  const detailReqOnly = "https://groupedreadmore.hrmdirect.com/employment/job-opening.php?req=HRM3101";

  const raw = await source.fetchList(company, {
    fetcher: async (url) => {
      if (url === listUrl) {
        return {
          html: `
            <div class='jobListItem'>
              <div class='jobListTitle'><h4><a href="job-opening.php?req=HRM3101&req_loc=5001&#job">Messenger</a></h4></div>
              <div class='jobListLink'><a href="job-opening.php?req=HRM3101&#job">Read More</a></div>
            </div>
          `,
          status: 200,
          url
        };
      }
      if (url === detailWithReqLoc || url === detailReqOnly) {
        return {
          html: `<table class="viewFields">
            <tr><td class="viewFieldName"><b>Location:</b></td><td class="viewFieldValue">New York, NY<br></td></tr>
            <tr><td class="viewFieldName"><b>Type of Hire:</b></td><td class="viewFieldValue">Experienced Hires<br></td></tr>
          </table>`,
          status: 200,
          url
        };
      }
      return { html: "", status: 404, url };
    }
  });

  const parsed = source.parse(raw, company);
  assert.equal(parsed.length, 1);
  const normalized = source.normalize(parsed[0], company);
  assert.equal(normalized.source_job_id, "HRM3101");
  assert.equal(normalized.position_name, "Messenger");
  assert.equal(normalized.location_text, "New York, NY");
  assert.equal(normalized.country, "United States");
  assert.equal(evaluatePublicPosting(normalized, { parserVersion: source.parserVersion }).status, "accepted");
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

test("hrmdirect source module accepts labeled detail body location section remote evidence", async () => {
  const source = getSourceModule("hrmdirect");
  const sourceDir = path.join(__dirname, "hrmdirect");
  const fixture = readJson(path.join(sourceDir, "fixtures", "body-location-section-remote.json"));

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
  assert.equal(normalized.country, "");
  assert.equal(normalized.city, "");
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

test("hrmdirect source module preserves Puerto Rico numeric region evidence", () => {
  const source = getSourceModule("hrmdirect");
  const company = {
    company_name: "Fixture HRMDirect Puerto Rico",
    ATS_name: "hrmdirect",
    url_string: "https://prfixture.hrmdirect.com/employment/job-openings.php"
  };
  const parsed = source.parse({
    html: `<table><tr class="reqitem">
      <td class="departments reqitem ReqRowClick">VEG</td>
      <td class="posTitle reqitem ReqRowClick"><a href="job-opening.php?req=3725496&req_loc=1339384">Scheduler / Planning Engineer</a></td>
      <td class="cities reqitem ReqRowClick">Humacao</td>
      <td class="state reqitem ReqRowClick">069</td>
    </tr></table>`,
    __listUrl: "https://prfixture.hrmdirect.com/employment/job-openings.php?search=true"
  }, company);
  const [normalized] = parsed.map((posting) => source.normalize(posting, company));

  assert.equal(normalized.source_job_id, "3725496");
  assert.equal(normalized.location_text, "Humacao, 069");
  assert.equal(normalized.country, "Puerto Rico");
  assert.equal(normalized.region, "North America");
  assert.equal(normalized.city, "Humacao");
  assert.equal(normalized.remote_type, "unknown");
  assert.equal(normalized.source_evidence.location_source, "labeled_html");
  assert.equal(normalized.source_evidence.location_path, "td.cities + td.state");
  assert.equal(normalized.source_evidence.location_rule_name, "hrmdirect_list_puerto_rico_numeric_region");
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

test("hrmdirect source module skips exact placeholder titles", async () => {
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

test("hrmdirect source module accepts labeled office remote region scopes", async () => {
  const source = getSourceModule("hrmdirect");
  const sourceDir = path.join(__dirname, "hrmdirect");
  const fixture = readJson(path.join(sourceDir, "fixtures", "office-remote-region-scope.json"));

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
    assert.equal(row.country, expected.country);
    assert.equal(row.remote_type, expected.remote_type);
    assert.equal(row.source_evidence.location_source, expected.location_source);
    assert.equal(row.source_evidence.location_path, expected.location_path);
    assert.equal(row.source_evidence.location_rule_name, expected.location_rule_name);
    assert.equal(row.source_evidence.remote_source, expected.remote_source);
    assert.equal(row.source_evidence.remote_path, expected.remote_path);
    assert.equal(row.source_evidence.remote_rule_name, expected.remote_rule_name);
    assert.deepEqual(row.source_failure_reasons || [], []);
    assert.equal(evaluatePublicPosting(row, { parserVersion: source.parserVersion }).status, "accepted");
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

test("hrmdirect source module quarantines blank detail locations with department and body hints", async () => {
  const source = getSourceModule("hrmdirect");
  const sourceDir = path.join(__dirname, "hrmdirect");
  const fixture = readJson(path.join(sourceDir, "fixtures", "blank-detail-location-quarantine.json"));

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
    assert.equal(row.location_text || "", expected.location_text);
    assert.equal(row.country || "", expected.country);
    assert.equal(row.remote_type, expected.remote_type);
    assert.equal(row.department, expected.department);
    assert.equal(row.source_evidence.location_path || "", "");
    assert.equal(row.source_evidence.location_rule_name || "", "");
    assert.equal(row.source_evidence.remote_path || "", "");
    assert.equal(row.source_evidence.remote_rule_name || "", "");
    assert.equal(row.source_evidence.detail_fetch_status, 200);
    for (const reason of expected.source_failure_reasons) {
      assert.ok(row.source_failure_reasons.includes(reason), `missing ${reason} for ${sourceJobId}`);
    }
    const gate = evaluatePublicPosting(row, { parserVersion: source.parserVersion });
    assert.equal(gate.status, "quarantined");
    assert.ok(gate.reason_codes.includes("no_geo_no_remote"));
  }
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
