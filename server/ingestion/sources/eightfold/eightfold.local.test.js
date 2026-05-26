const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const sourceDir = __dirname;

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(sourceDir, "fixtures", name), "utf8"));
}

test("eightfold discovery accepts careers routes and rejects non-Eightfold hosts", () => {
  const { createDiscover, parseEightfoldCompany, supportedEightfoldHost } = require("./discover");
  const company = readJson("company.json");
  const discover = createDiscover("source-eightfold-v1");

  const discovered = discover(company);

  assert.equal(supportedEightfoldHost("fixture.eightfold.ai"), true);
  assert.equal(supportedEightfoldHost("evil-eightfold.ai.example"), false);
  assert.equal(parseEightfoldCompany("https://fixture.eightfold.ai/careers/job/ef-1").boardUrl, "https://fixture.eightfold.ai/careers");
  assert.equal(parseEightfoldCompany("https://fixture.example/careers"), null);
  assert.equal(discovered.ats_key, "eightfold");
  assert.equal(discovered.source_family, "enterprise_api");
  assert.equal(discovered.list_url, "https://fixture.eightfold.ai/careers");
  assert.equal(discovered.config.siteBaseUrl, "https://fixture.eightfold.ai");
});

test("eightfold fetchList reads board group id, calls jobs API, and keeps source metadata", async () => {
  const { createDiscover } = require("./discover");
  const { createFetchList } = require("./fetchList");
  const { parseEightfoldPostingsFromApi } = require("./parse");
  const company = readJson("company.json");
  const fixture = readJson("fetch-list.json");
  const calls = [];
  const fetchList = createFetchList({ discover: createDiscover("source-eightfold-v1") });

  const raw = await fetchList(company, {
    fetcher: async (url, target) => {
      calls.push({ url, method: target.method, accept: target.headers.Accept });
      if (url === "https://fixture.eightfold.ai/careers") {
        return {
          status: 200,
          url,
          body: fixture.boardHtml
        };
      }
      return {
        status: 200,
        url,
        body: JSON.stringify(fixture.api)
      };
    }
  });

  assert.deepEqual(calls.map((call) => ({ url: call.url, method: call.method })), [
    { url: "https://fixture.eightfold.ai/careers", method: "GET" },
    { url: "https://fixture.eightfold.ai/api/pcsx/search?domain=fixture-domain&query=&location=&start=0&", method: "GET" }
  ]);
  assert.equal(raw.__sourceConfig.groupId, "fixture-domain");
  assert.equal(raw.__sourceConfig.apiUrl, "https://fixture.eightfold.ai/api/pcsx/search?domain=fixture-domain&query=&location=&start=0&");
  assert.equal(raw.__sourceRequest.boardUrl, "https://fixture.eightfold.ai/careers");
  assert.equal(raw.__sourceRequest.apiUrl, "https://fixture.eightfold.ai/api/pcsx/search?domain=fixture-domain&query=&location=&start=0&");
  assert.equal(parseEightfoldPostingsFromApi("Fixture Eightfold", raw.__sourceConfig, raw).length, 1);
});

test("eightfold fetchList rejects missing group ids, non-JSON API payloads, and redirected hosts", async () => {
  const { createDiscover } = require("./discover");
  const { createFetchList } = require("./fetchList");
  const company = readJson("company.json");
  const fetchList = createFetchList({ discover: createDiscover("source-eightfold-v1") });

  await assert.rejects(
    () => fetchList(company, {
      fetcher: async () => ({ status: 200, url: "https://fixture.eightfold.ai/careers", body: "<html></html>" })
    }),
    /window\._EF_GROUP_ID value not found/
  );

  await assert.rejects(
    () => fetchList(company, {
      fetcher: async (url) => {
        if (url.endsWith("/careers")) return { status: 200, url, body: "window._EF_GROUP_ID = 'fixture-domain';" };
        return { status: 200, url, body: "<html>not json</html>" };
      }
    }),
    /Eightfold jobs API response was not JSON/
  );

  await assert.rejects(
    () => fetchList(company, {
      fetcher: async () => ({ status: 200, url: "https://example.com/careers", body: "window._EF_GROUP_ID = 'fixture-domain';" })
    }),
    /Eightfold URL redirected to unexpected host/
  );
});

test("eightfold index parse preserves legacy API behavior and filters rows without posting dates", () => {
  const commonPath = require.resolve("../common");
  const indexPath = require.resolve("./index");
  const common = require(commonPath);
  const originalCreateSourceModule = common.createSourceModule;
  common.createSourceModule = (atsKey) => {
    assert.equal(atsKey, "eightfold");
    return {
      atsKey,
      key: atsKey,
      family: "enterprise_api",
      status: "disabled",
      parserVersion: "source-eightfold-v1",
      officialDocs: "observed Eightfold careers HTML plus search API",
      discover: () => ({}),
      fetchList: async () => ({}),
      parse: () => [],
      normalize: (posting) => posting,
      validate: () => ({ ok: true })
    };
  };
  delete require.cache[indexPath];

  try {
    const source = require("./index");
    const company = readJson("company.json");
    const rawList = readJson("list.json");
    rawList.data.positions.push({
      id: "ef-missing-date",
      name: "Missing Date Role",
      positionUrl: "/careers/job/ef-missing-date",
      locations: ["Austin, TX, United States"]
    });

    const parsed = source.parse(rawList, company);

    assert.equal(source.parserVersion, "source-eightfold-v1");
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].source_job_id, "ATS-1001");
    assert.equal(parsed[1].source_job_id, "ef-1002");
    assert.ok(parsed.every((posting) => posting.posting_date));
  } finally {
    common.createSourceModule = originalCreateSourceModule;
    delete require.cache[indexPath];
  }
});
