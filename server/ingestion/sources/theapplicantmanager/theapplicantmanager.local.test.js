const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = require("./index");

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8"));
}

function response(body, url, options = {}) {
  return {
    ok: options.ok !== false,
    status: options.status || 200,
    url,
    headers: {
      get(name) {
        return String(name || "").toLowerCase() === "content-type" ? options.contentType || "text/html" : "";
      }
    },
    async text() {
      return body;
    }
  };
}

test("theapplicantmanager discover exposes source-local public careers route", () => {
  const company = readJson("company.json");
  const discovered = source.discover(company);

  assert.equal(discovered.ats_key, "theapplicantmanager");
  assert.equal(discovered.source_family, "html_detail");
  assert.equal(discovered.list_url, "https://theapplicantmanager.com/careers?co=fixtureco");
  assert.equal(discovered.parser_version, "source-theapplicantmanager-v1");
  assert.equal(discovered.config.companyCodeLower, "fixtureco");
});

test("theapplicantmanager fetchList uses source-local metadata and final-host guard", async () => {
  const company = readJson("company.json");
  const rawList = readJson("list.json");
  const calls = [];

  const payload = await source.fetchList(company, {
    fetcher: async (url, target) => {
      calls.push({ url, target });
      return response(rawList.html, url);
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://theapplicantmanager.com/careers?co=fixtureco");
  assert.equal(calls[0].target.method, "GET");
  assert.equal(calls[0].target.source_key, "theapplicantmanager");
  assert.equal(calls[0].target.source_family, "html_detail");
  assert.equal(payload.__sourceConfig.companyCodeLower, "fixtureco");
  assert.equal(payload.__sourceFetchFinalUrl, "https://theapplicantmanager.com/careers?co=fixtureco");

  await assert.rejects(
    () => source.fetchList(company, {
      fetcher: async () => response(rawList.html, "https://example.com/careers")
    }),
    /unexpected host/
  );
});

test("theapplicantmanager parses source ids, departments, explicit location, and resume skips", () => {
  const company = readJson("company.json");
  const rawList = readJson("list.json");
  const parsed = source.parse(rawList, company);

  assert.equal(parsed.length, 3);
  assert.deepEqual(parsed.map((posting) => posting.source_job_id), ["ENG-1001", "ENG-1002", "OPS-2001"]);
  assert.equal(parsed[0].department, "Engineering");
  assert.equal(parsed[0].location, "Remote");
  assert.equal(parsed[2].department, "Operations");
  assert.equal(parsed[2].location, "Hybrid - Toronto, Canada");
  assert.equal(parsed.some((posting) => /resume/i.test(posting.position_name)), false);
});

test("theapplicantmanager normalizes fixture evidence without invented dates", () => {
  const company = readJson("company.json");
  const rawList = readJson("list.json");
  const expectedRows = readJson("expected-normalized.json");
  const parsed = source.parse(rawList, company);
  const normalized = parsed.map((posting) => source.normalize(posting, company));

  assert.equal(normalized.length, expectedRows.length);
  for (let index = 0; index < expectedRows.length; index += 1) {
    const row = normalized[index];
    const expected = expectedRows[index];
    assert.equal(source.validate(row).ok, true);
    assert.equal(row.ats_key, "theapplicantmanager");
    assert.equal(row.parser_key, "theapplicantmanager");
    assert.equal(row.parser_version, "source-theapplicantmanager-v1");
    assert.equal(row.source_job_id, expected.source_job_id);
    assert.equal(row.company_name, expected.company_name);
    assert.equal(row.position_name, expected.position_name);
    assert.equal(row.country, expected.country || "");
    if (expected.city) assert.equal(row.city, expected.city);
    assert.equal(row.remote_type, expected.remote_type);
    assert.equal(row.posting_date, null);
    assert.equal(row.parser_confidence, expected.parser_confidence);
    assert.equal(source.validatePublic(row).status, "accepted");
  }
});

test("theapplicantmanager rejects or quarantines invalid source shapes", () => {
  const company = readJson("company.json");
  const invalid = readJson("invalid-shapes.json");

  for (const item of invalid.cases) {
    const normalized = source.normalize(item.posting, company);
    const basic = source.validate(normalized);
    const gate = source.validatePublic(normalized);
    if (item.expected === "rejected") {
      assert.equal(basic.ok, false, item.name);
      assert.match(basic.error, new RegExp(item.reason));
    } else {
      assert.equal(basic.ok, true, item.name);
      assert.equal(gate.status, "quarantined", item.name);
      assert.ok(gate.reason_codes.some((reason) => new RegExp(item.reason).test(reason)), item.name);
    }
  }
});

test("theapplicantmanager parse preserves __legacyParsed payloads", () => {
  const legacy = [{ source_job_id: "legacy", job_posting_url: "https://theapplicantmanager.com/jobs?pos=legacy" }];
  assert.deepEqual(source.parse({ __legacyParsed: legacy }, readJson("company.json")), legacy);
});
