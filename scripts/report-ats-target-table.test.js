const assert = require("assert");
const { test } = require("node:test");

const {
  buildMarkdown,
  buildTargetRows,
  thresholdProfileFor
} = require("./report-ats-target-table");

test("buildTargetRows computes coverage and ranks high-volume ATS by live rows", () => {
  const rows = buildTargetRows([
    {
      ats_key: "greenhouse",
      display_name: "Greenhouse",
      visible_rows: 10000,
      configured_companies: 120,
      posting_companies: 80,
      location_text_rows: 9400,
      any_geo_rows: 8600,
      complete_geo_rows: 4100,
      country_rows: 8500,
      region_rows: 5000,
      city_rows: 4700,
      remote_known_rows: 9600,
      posting_date_rows: 6800,
      source_job_id_rows: 9900,
      seen_24h_rows: 500,
      targets_due: 11,
      targets_success_24h: 7,
      source_runs_24h: 5,
      target_failures_24h: 2,
      parser_attention_24h: 1,
      source_enabled: true,
      protection_status: "normal"
    },
    {
      ats_key: "jobvite",
      display_name: "Jobvite",
      visible_rows: 1200,
      configured_companies: 10,
      posting_companies: 8,
      location_text_rows: 1100,
      any_geo_rows: 300,
      complete_geo_rows: 90,
      country_rows: 300,
      region_rows: 90,
      city_rows: 90,
      remote_known_rows: 600,
      posting_date_rows: 100,
      source_job_id_rows: 500,
      source_enabled: true,
      protection_status: "normal"
    }
  ]);

  assert.equal(rows[0].ats_key, "greenhouse");
  assert.equal(rows[0].location_text_pct, 94);
  assert.equal(rows[0].any_geo_pct, 86);
  assert.equal(rows[0].complete_geo_pct, 41);
  assert.equal(rows[0].remote_known_pct, 96);
  assert.equal(rows[0].posting_date_pct, 68);
  assert.equal(rows[0].threshold_profile, "high_volume_quality_gate");
  assert.match(rows[0].next_action, /geo/i);
  assert.match(rows[0].next_action, /worker errors/i);
});

test("thresholdProfileFor uses fixture-first policy for uncertified live ATS", () => {
  const profile = thresholdProfileFor({
    ats_key: "jobvite",
    visible_rows: 1200,
    source_enabled: true,
    parser_fixture_status: "missing",
    adapter_tier: "embedded-or-semi-structured"
  });

  assert.equal(profile.profile, "fixture_first");
  assert.equal(profile.minimum_confidence, 0.85);
  assert.match(profile.public_write_rule, /raw parser fixture/i);
});

test("buildMarkdown includes target conditions and field coverage columns", () => {
  const rows = buildTargetRows([
    {
      ats_key: "lever",
      display_name: "Lever",
      visible_rows: 50,
      configured_companies: 4,
      posting_companies: 3,
      location_text_rows: 50,
      any_geo_rows: 45,
      complete_geo_rows: 20,
      remote_known_rows: 49,
      posting_date_rows: 40,
      source_job_id_rows: 50,
      source_enabled: true,
      protection_status: "normal"
    }
  ]);
  const markdown = buildMarkdown(rows, { generatedAt: "2026-05-24T00:00:00.000Z" });

  assert.match(markdown, /ATS Target Table/);
  assert.match(markdown, /worker ok 24h/);
  assert.match(markdown, /worker fail 24h/);
  assert.match(markdown, /parser attn 24h/);
  assert.match(markdown, /posting date %/);
  assert.match(markdown, /parse threshold/);
  assert.match(markdown, /All ATS keys must be reviewed individually/);
  assert.match(markdown, /\| `lever` \|/);
});
