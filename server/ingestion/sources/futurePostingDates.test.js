"use strict";

// Regression tests: the five ATS parsers below stored application deadlines /
// scheduled-open / unposting / employment-start dates as posting_date, yielding
// ~1000 production rows with posted_at_epoch far in the future. Each fixture
// carries a deadline/future-only posting (posting_date must be null) and a
// posting that also has a real past posted date (that past date must survive).
//
// `now` is injected via config.__nowEpoch so the assertions are deterministic
// and never time-bomb. Fixture past dates are 2026-05; future dates are 2030+.

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  guardPostingDateAgainstFuture,
  isFuturePostingDate
} = require("./sourceModuleHelpers");
const { parsePinpointHqPostingsFromApi } = require("./pinpointhq/parse");
const { parseZohoPostingsFromHtml } = require("./zoho/parse");
const { parseTalentreefPostingsFromSearchResponse } = require("./talentreef/parse");
const { extractTaleoPostingsFromRest, extractTaleoPostingsFromAjax } = require("./taleo/parse");
const { parseApplyToJobPostingsFromHtml } = require("./applytojob/parse");

// 2026-07-01T00:00:00Z — after every fixture "past" date, before the 2030+ ones.
const NOW_EPOCH = Math.floor(Date.UTC(2026, 6, 1) / 1000);

function readFixture(...segments) {
  return fs.readFileSync(path.join(__dirname, ...segments), "utf8");
}

function readJsonFixture(...segments) {
  return JSON.parse(readFixture(...segments));
}

function byUrlIncludes(postings, needle) {
  return postings.find((posting) => String(posting.job_posting_url || "").includes(needle));
}

test("guardPostingDateAgainstFuture nulls future dates and keeps valid ones", () => {
  assert.equal(guardPostingDateAgainstFuture("2030-07-24T23:59:59-05:00", NOW_EPOCH), null);
  assert.equal(guardPostingDateAgainstFuture("2026-05-06", NOW_EPOCH), "2026-05-06");
  // Within the 24h grace window a near-now date is preserved.
  assert.equal(guardPostingDateAgainstFuture("2026-07-01", NOW_EPOCH), "2026-07-01");
  assert.equal(guardPostingDateAgainstFuture(null, NOW_EPOCH), null);
  // Unparseable strings pass through unchanged (downstream stores null epoch).
  assert.equal(guardPostingDateAgainstFuture("Posted today", NOW_EPOCH), "Posted today");
  assert.equal(isFuturePostingDate("2036-05-24", NOW_EPOCH), true);
  assert.equal(isFuturePostingDate("2026-05-08", NOW_EPOCH), false);
});

test("pinpointhq: deadline_at never becomes posting_date", () => {
  const responseJson = readJsonFixture("pinpointhq", "fixtures", "future-deadline-list.json");
  const config = { baseOrigin: "https://fixtureco.pinpointhq.com", __nowEpoch: NOW_EPOCH };
  const postings = parsePinpointHqPostingsFromApi("Fixture Co", config, responseJson);

  const deadlineOnly = byUrlIncludes(postings, "deadline-only-first-officer");
  const postedRow = byUrlIncludes(postings, "posted-revenue-analyst");
  assert.equal(deadlineOnly.posting_date, null);
  assert.equal(postedRow.posting_date, "2026-05-06T08:00:00+03:00");
});

test("zoho: future Date_Opened (scheduled opening) yields null posting_date", () => {
  const pageHtml = readJsonFixture("zoho", "fixtures", "future-date-list.json");
  const config = { careersUrl: "https://fixtureco.zohorecruit.com/jobs/Careers", __nowEpoch: NOW_EPOCH };
  const postings = parseZohoPostingsFromHtml("Fixture Co", config, pageHtml);

  const future = postings.find((p) => p.source_job_id === "476000000009001");
  const past = postings.find((p) => p.source_job_id === "476000000009002");
  assert.equal(future.posting_date, null);
  assert.equal(past.posting_date, "2026-05-06");
});

test("talentreef: startDate (employment start) never becomes posting_date", () => {
  const responseJson = readJsonFixture("talentreef", "fixtures", "future-dates-list.json");
  const config = { baseOrigin: "https://fixtureco.talentreef.com", __nowEpoch: NOW_EPOCH };
  const postings = parseTalentreefPostingsFromSearchResponse("Fixture Co", config, responseJson);

  const startDateOnly = byUrlIncludes(postings, "TR9001");
  const createdRow = byUrlIncludes(postings, "TR9002");
  assert.equal(startDateOnly.posting_date, null);
  assert.equal(createdRow.posting_date, "2026-05-08");
});

test("taleo REST: unposting date skipped in favor of the real posted date", () => {
  const requisitions = readJsonFixture("taleo", "fixtures", "future-dates-list.json");
  const config = { baseSectionUrl: "https://fixtureco.taleo.net/careersection/x", lang: "en", __nowEpoch: NOW_EPOCH };
  const postings = extractTaleoPostingsFromRest("Fixture Co", config, requisitions);

  const unpostingOnly = postings.find((p) => p.source_job_id === "9001");
  const postedRow = postings.find((p) => p.source_job_id === "9002");
  const relativeRow = postings.find((p) => p.source_job_id === "9003");
  // 9001 has only "May 24, 2036" (unposting) -> null, not a future date.
  assert.equal(unpostingOnly.posting_date, null);
  // 9002 has "May 24, 2036" AND "May 8, 2026": the past posted date wins.
  assert.equal(postedRow.posting_date, "May 8, 2026");
  // Relative "Posted today" resolves to now and is preserved.
  assert.equal(relativeRow.posting_date, "Posted today");
});

test("taleo AJAX: future unposting date yields null, past posted date survives", () => {
  const ajaxText = readFixture("taleo", "fixtures", "future-dates-ajax.txt");
  const config = { baseSectionUrl: "https://fixtureco.taleo.net/careersection/x", lang: "en", __nowEpoch: NOW_EPOCH };
  const postings = extractTaleoPostingsFromAjax("Fixture Co", config, ajaxText);

  const futureDeadline = postings.find((p) => p.position_name === "Future Deadline Specialist");
  const posted = postings.find((p) => p.position_name === "Posted Analyst");
  assert.equal(futureDeadline.posting_date, null);
  assert.equal(posted.posting_date, "May 11, 2026");
});

test("applytojob: future calendar date (deadline) yields null posting_date", () => {
  const payload = readJsonFixture("applytojob", "fixtures", "future-date-list.json");
  const config = { baseOrigin: "https://fixtureco.applytojob.com", __nowEpoch: NOW_EPOCH };
  const postings = parseApplyToJobPostingsFromHtml("Fixture Co", config, payload);

  const futureDated = byUrlIncludes(postings, "FUT9001");
  const pastDated = byUrlIncludes(postings, "FUT9002");
  assert.equal(futureDated.posting_date, null);
  assert.equal(pastDated.posting_date, "05/08/2026");
});
