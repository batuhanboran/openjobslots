"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { evaluatePublicPosting } = require("../../publicPostingGate");
const source = require("./index");
const { buildSchoolspringSearchUrl } = require("./fetchList");

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", fileName), "utf8"));
}

test("SchoolSpring source module parses list fixture with source ids and public evidence", () => {
  const company = readJson("company.json");
  const rawList = readJson("list.json");
  const expectedRows = readJson("expected-normalized.json");

  const parsed = source.parse(rawList, company);
  assert.equal(parsed.length, expectedRows.length);
  const normalized = parsed.map((posting) => source.normalize(posting, company));

  for (let index = 0; index < expectedRows.length; index += 1) {
    const row = normalized[index];
    const expected = expectedRows[index];
    assert.equal(row.source_job_id, expected.source_job_id);
    assert.equal(row.company_name, expected.company_name);
    assert.equal(row.position_name, expected.position_name);
    assert.equal(row.canonical_url, expected.job_posting_url);
    assert.equal(row.country, expected.country || "");
    if (expected.city) assert.equal(row.city, expected.city);
    assert.equal(row.remote_type, expected.remote_type);
    assert.equal(row.posting_date, expected.posting_date);
    assert.equal(row.parser_confidence, expected.parser_confidence);
    assert.equal(row.source_evidence.route_kind, "schoolspring_public_jobs_api");
    assert.equal(source.validate(row).ok, true);
    assert.equal(evaluatePublicPosting(row, { parserVersion: source.parserVersion }).status, "accepted");
  }
});

test("SchoolSpring source module rejects and quarantines invalid source shapes", () => {
  const company = readJson("company.json");
  const invalid = readJson("invalid-shapes.json");

  for (const item of invalid.cases) {
    const normalized = source.normalize(item.posting, company);
    const basic = source.validate(normalized);
    const gate = source.validatePublic(normalized);
    if (item.expected === "rejected") {
      assert.equal(basic.ok, false, `${item.name} should fail source validation`);
      assert.match(basic.error, new RegExp(item.reason));
      continue;
    }
    assert.equal(basic.ok, true, `${item.name} should pass basic validation`);
    assert.equal(gate.status, "quarantined", `${item.name} should be quarantined`);
    assert.ok(gate.reason_codes.includes(item.reason), `${item.name} should include ${item.reason}`);
  }
});

test("SchoolSpring source module fetches bounded API pages with source-local metadata", async () => {
  const company = readJson("company.json");
  const calls = [];
  const firstPageUrl = buildSchoolspringSearchUrl(1, 2);
  const secondPageUrl = buildSchoolspringSearchUrl(2, 2);

  const raw = await source.fetchList(company, {
    pageSize: 2,
    maxPages: 3,
    referenceEpoch: Math.floor(Date.parse("2026-05-26T12:00:00Z") / 1000),
    fetcher: async (url, target) => {
      calls.push({ url, method: target.method, headers: target.headers });
      if (url === firstPageUrl) {
        return {
          status: 200,
          url,
          value: {
            jobsList: [
              {
                jobId: 9002001,
                title: "Runtime Science Teacher",
                employer: "Runtime Public Schools",
                location: "Boston, MA",
                displayDate: "Posted Today"
              },
              {
                jobId: 9002002,
                title: "Runtime Remote Counselor",
                employer: "Runtime Virtual Academy",
                location: "Remote - United States",
                displayDate: "Posted Yesterday"
              }
            ]
          }
        };
      }
      if (url === secondPageUrl) {
        return {
          status: 200,
          url,
          value: {
            jobsList: [
              {
                jobId: 9002003,
                title: "Runtime Hybrid Coach",
                employer: "Runtime County Schools",
                location: "Hybrid - Denver, CO",
                displayDate: "2026-05-25"
              }
            ]
          }
        };
      }
      return { status: 404, url, body: "" };
    }
  });

  assert.deepEqual(calls.map((call) => call.url), [firstPageUrl, secondPageUrl]);
  assert.equal(raw.__sourceConfig.fetched_pages, 2);
  assert.equal(raw.__sourceConfig.page_size, 2);
  assert.equal(raw.value.jobsList.length, 3);
  const parsed = source.parse(raw, company);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].source_job_id, "9002001");
  assert.equal(parsed[1].remote_type, "remote");
});

test("SchoolSpring source fetch rejects redirects to unexpected hosts", async () => {
  const company = readJson("company.json");
  await assert.rejects(
    () => source.fetchList(company, {
      fetcher: async (url) => ({
        status: 200,
        url: "https://example.com/api/Jobs/GetPagedJobsWithSearch",
        value: { jobsList: [] }
      })
    }),
    /unexpected host/
  );
});
