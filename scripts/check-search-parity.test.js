const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildPostingsUrl,
  checkFilterViolations,
  compareTopUrls,
  isSortedByLastSeen,
  parseParityArgs,
  requiredFieldIssues,
  shouldAssertLastSeenOrder
} = require("./check-search-parity");

test("parity args default to representative search cases", () => {
  const options = parseParityArgs([], {});
  assert.equal(options.limit, 10);
  assert.equal(options.offset, 0);
  assert.equal(options.cases.length, 12);
  assert.ok(options.cases.some((item) => item.search === "t\u00fcrkiye"));
  assert.ok(options.cases.some((item) => item.search === "turkyie"));
  assert.ok(options.cases.some((item) => item.search === "turksih jobs"));
  assert.ok(options.cases.some((item) => item.search === "united states"));
});

test("parity args support case override, API base URL, and fail-on-mismatch", () => {
  const options = parseParityArgs([
    "--case=director,remote",
    "--api-base-url=http://127.0.0.1:8787/",
    "--limit=7",
    "--offset=3",
    "--fail-on-mismatch"
  ], {});
  assert.deepEqual(options.cases.map((item) => item.search), ["director", "remote"]);
  assert.equal(options.apiBaseUrl, "http://127.0.0.1:8787");
  assert.equal(options.limit, 7);
  assert.equal(options.offset, 3);
  assert.equal(options.failOnMismatch, true);
});

test("postings URL includes filters used by public API", () => {
  const url = buildPostingsUrl(
    "http://127.0.0.1:8787",
    { search: "istanbul", countries: ["Turkey"], remote: "remote" },
    5,
    10
  );
  assert.equal(url.toString(), "http://127.0.0.1:8787/postings?search=istanbul&limit=5&offset=10&remote=remote&countries=Turkey");
});

test("required field issues detect bad search result rows", () => {
  const issues = requiredFieldIssues([
    { canonical_url: "not-a-url", title: "", company: "" },
    { canonical_url: "https://example.com/jobs/1", title: "Engineer", company: "Acme" }
  ], "meili");
  assert.deepEqual(issues.map((item) => item.field), ["canonical_url", "title", "company"]);
});

test("filter violation checks country and remote mode", () => {
  const violations = checkFilterViolations(
    { countries: ["Turkey"], remote: "remote" },
    [
      { canonical_url: "https://example.com/1", country: "Germany", remote_type: "remote" },
      { canonical_url: "https://example.com/2", country: "Turkey", remote_type: "onsite" }
    ],
    "active"
  );
  assert.deepEqual(violations.map((item) => item.field), ["country", "remote_type"]);
});

test("filter violation checks infer public API country and remote evidence", () => {
  const violations = checkFilterViolations(
    { countries: ["United States"], remote: "remote" },
    [
      {
        job_posting_url: "https://example.com/remote-us",
        position_name: "Remote Customer Support",
        location: "Seattle, Washington, United States"
      }
    ],
    "api"
  );
  assert.deepEqual(violations, []);
});

test("filter violation accepts multi-country public API location when expected country is present", () => {
  const violations = checkFilterViolations(
    { countries: ["Germany"] },
    [
      {
        job_posting_url: "https://example.com/germany-uk",
        position_name: "Category Lead, Germany",
        location: "Berlin, Germany / London, England, United Kingdom"
      }
    ],
    "api"
  );
  assert.deepEqual(violations, []);
});

test("top URL and sort helpers report parity-relevant differences", () => {
  assert.deepEqual(compareTopUrls(["a", "b"], ["a", "c"]), [{ index: 1, left: "b", right: "c" }]);
  assert.equal(isSortedByLastSeen([{ last_seen_epoch: 3 }, { last_seen_epoch: 2 }]), true);
  assert.equal(isSortedByLastSeen([{ last_seen_epoch: 2 }, { last_seen_epoch: 3 }]), false);
  assert.equal(shouldAssertLastSeenOrder("last_seen"), true);
  assert.equal(shouldAssertLastSeenOrder("recent"), true);
  assert.equal(shouldAssertLastSeenOrder("relevance"), false);
  assert.equal(shouldAssertLastSeenOrder("posted_date"), false);
});
