const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { evaluatePublicPosting } = require("../../publicPostingGate");
const source = require("./index");

const fixturesDir = path.join(__dirname, "fixtures");
const company = require(path.join(fixturesDir, "company.json"));
const listFixture = require(path.join(fixturesDir, "list.json"));
const expectedRows = require(path.join(fixturesDir, "expected-normalized.json"));
const invalidShapes = require(path.join(fixturesDir, "invalid-shapes.json"));

test("k12jobspot discover uses the public search API and source metadata", () => {
  const discovered = source.discover(company);
  assert.equal(discovered.ats_key, "k12jobspot");
  assert.equal(discovered.source_family, "public_sector");
  assert.equal(discovered.list_url, "https://api.k12jobspot.com/api/Jobs/Search");
  assert.equal(discovered.config.publicOrigin, "https://www.k12jobspot.com");
});

test("k12jobspot fetchList posts bounded search windows and filters stale pages", async () => {
  const calls = [];
  const payload = await source.fetchList(company, {
    pageSize: 2,
    maxPages: 3,
    referenceEpoch: Math.floor(Date.parse("2026-05-24T12:00:00Z") / 1000),
    fetcher: async (url, target) => {
      calls.push({ url, method: target.method, body: JSON.parse(target.body) });
      if (calls.length === 1) {
        return {
          status: 200,
          url,
          json: async () => ({
            jobs: [
              listFixture.jobs[0],
              listFixture.jobs[0]
            ]
          })
        };
      }
      return {
        status: 200,
        url,
        json: async () => ({
          jobs: [
            {
              id: "stale-1",
              title: "Old Teacher",
              hiringOrganization: "Old District",
              postedDate: "2026-01-01",
              location: { city: "Denver", regionCode: "CO" }
            }
          ]
        })
      };
    }
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].body, {
    searchPhrase: "",
    filters: [
      { name: "positionAreas", filters: [] },
      { name: "gradeLevels", filters: [] },
      { name: "jobTypes", filters: [] }
    ],
    pageStartIndex: 1,
    pageEndIndex: 2
  });
  assert.equal(calls[1].body.pageStartIndex, 3);
  assert.equal(payload.jobs.length, 1);
  assert.equal(payload.__sourceConfig.page_size, 2);
  assert.equal(payload.__sourceConfig.fetched_pages, 2);
  assert.equal(payload.__sourceRequest.rateLimitMs, 60 * 1000);
});

test("k12jobspot parser emits source ids, US geo evidence, and normalized public rows", () => {
  const parsed = source.parse(listFixture, company);
  assert.equal(parsed.length, expectedRows.length);
  assert.equal(parsed[0].source_job_id, "123456");
  assert.equal(parsed[0].country, "United States");
  assert.equal(parsed[0].region, "IL");
  assert.equal(parsed[0].city, "Aurora");
  assert.equal(parsed[0].source_evidence.route_kind, "k12jobspot_public_jobs_api");

  const normalized = parsed.map((posting) => source.normalize(posting, company));
  for (let index = 0; index < expectedRows.length; index += 1) {
    const row = normalized[index];
    const expected = expectedRows[index];
    assert.equal(source.validate(row).ok, true);
    assert.equal(row.ats_key, "k12jobspot");
    assert.equal(row.parser_key, "k12jobspot");
    assert.equal(row.parser_version, source.parserVersion);
    assert.equal(row.source_family, "public_sector");
    assert.equal(row.source_job_id, expected.source_job_id);
    assert.equal(row.company_name, expected.company_name);
    assert.equal(row.position_name, expected.position_name);
    assert.equal(row.canonical_url, expected.job_posting_url);
    assert.equal(row.location_text, expected.location_text);
    assert.equal(row.country, expected.country);
    assert.equal(row.region, expected.region);
    assert.equal(row.city, expected.city);
    assert.equal(row.remote_type, expected.remote_type);
    assert.equal(row.posting_date, expected.posting_date);
    assert.equal(row.parser_confidence, expected.parser_confidence);
    assert.equal(evaluatePublicPosting(row, { parserVersion: source.parserVersion }).status, "accepted");
  }
});

test("k12jobspot invalid shapes reject missing ids and quarantine ambiguous geo", () => {
  for (const item of invalidShapes.cases) {
    const normalized = source.normalize(item.posting, company);
    const basic = source.validate(normalized);
    const gate = evaluatePublicPosting(normalized, { parserVersion: source.parserVersion });
    if (item.expected === "rejected") {
      assert.equal(basic.ok, false, item.name);
      assert.match(basic.error, new RegExp(item.reason));
    } else {
      assert.equal(basic.ok, true, item.name);
      assert.equal(gate.status, "quarantined", item.name);
      assert.ok(gate.reason_codes.some((reason) => new RegExp(item.reason).test(reason)));
    }
  }
});
