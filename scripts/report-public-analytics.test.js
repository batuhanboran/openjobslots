const assert = require("node:assert/strict");
const { formatReport, parseArgs } = require("./report-public-analytics");

function testParseArgsDefaultsToIstanbulToday() {
  const options = parseArgs([], {});
  assert.equal(options.date, "today");
  assert.equal(options.timezone, "Europe/Istanbul");
  assert.equal(options.json, false);
}

function testFormatReportIncludesDeterministicDailySummary() {
  const report = {
    ok: true,
    read_only: true,
    date: "2026-05-22",
    timezone: "Europe/Istanbul",
    total_events: 7,
    anonymous_session_count: 2,
    event_counts: { postings: 4, suggest: 2, filter_options: 1 },
    top_endpoint: { endpoint: "/postings", event_type: "postings", count: 4 },
    top_terms: [{ query: "software engineer", count: 3 }],
    top_job_title_keywords: [{ query: "software engineer", count: 2 }],
    top_zero_result_queries: [{ query: "wordpress", count: 1 }],
    top_low_result_queries: [{ query: "teacher", count: 2 }],
    top_country_filters: [{ value: "United States", count: 3 }, { value: "Turkey", count: 1 }],
    remote_filter_counts: { all: 2, remote: 3, hybrid: 1, non_remote: 1, unknown: 0 },
    top_suggest_inputs: [{ query: "software", count: 2 }],
    top_filter_option_searches: [{ query: "remote", count: 1 }],
    result_count_distribution: {
      zero_result: 1,
      low_result: 2,
      normal_result: 4,
      unknown_result: 0
    },
    cache_status_counts: { HIT: 5, MISS: 2 },
    cache_hit_rate: 5 / 7,
    top_referrers: [{ host: "www.google.com", count: 2 }],
    top_user_agent_families: [{ family: "Chrome", count: 4 }]
  };

  const formatted = formatReport(report);

  assert.match(formatted, /Backend public search events: total=7, anonymous_sessions=2/);
  assert.match(formatted, /Top endpoint: \/postings \(4\)/);
  assert.match(formatted, /Top normalized query: software engineer \(3\)/);
  assert.match(formatted, /Top job title\/keyword: software engineer \(2\)/);
  assert.match(formatted, /Top zero-result queries: wordpress \(1\)/);
  assert.match(formatted, /Top low-result queries: teacher \(2\)/);
  assert.match(formatted, /Top requested countries: United States \(3\), Turkey \(1\)/);
  assert.match(formatted, /Remote filters: all=2, remote=3, hybrid=1, non_remote=1, unknown=0/);
  assert.match(formatted, /Result counts: zero=1, low=2, normal=4, unknown=0/);
  assert.match(formatted, /Cache: HIT=5, MISS=2, hit_rate=71\.43%/);
  assert.doesNotMatch(formatted, /Cloudflare.*Backend public search events/s);
}

function main() {
  testParseArgsDefaultsToIstanbulToday();
  testFormatReportIncludesDeterministicDailySummary();
  console.log("report-public-analytics tests passed");
}

if (require.main === module) {
  main();
}
