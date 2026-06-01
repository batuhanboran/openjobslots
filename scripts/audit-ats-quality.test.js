const assert = require("assert");
const {
  buildAtsScoreboard,
  buildSummary,
  detailRefetchNeeded,
  publicEnabledRecommendation,
  wavePriority
} = require("./audit-ats-quality");

function find(rows, key) {
  return rows.find((row) => row.ats_key === key);
}

function testScoreboardIncludesConfiguredAtsWithoutRows() {
  const rows = buildAtsScoreboard({
    atsItems: [
      { value: "greenhouse", label: "Greenhouse" },
      { value: "dayforcehcm", label: "Dayforce", enabledByDefault: false }
    ],
    qualitySummary: {
      by_source: [{
        source_ats: "greenhouse",
        total_visible_rows: 10,
        missing_country_count: 1,
        missing_country_pct: 10,
        missing_city_count: 8,
        missing_city_pct: 80,
        missing_any_normalized_geo_count: 8,
        missing_any_normalized_geo_pct: 80,
        weak_unknown_remote_type_count: 2,
        weak_unknown_remote_type_pct: 20
      }]
    },
    parserStats: {
      items: [{
        source_ats: "greenhouse",
        parser_version: "legacy-adapter-v1",
        parser_attention_count_24h: 0
      }]
    }
  });

  assert.equal(rows.length, 2);
  assert.equal(find(rows, "greenhouse").current_production_row_count, 10);
  assert.equal(find(rows, "greenhouse").parser_fixture_status, "parser-fixture-backed");
  assert.equal(find(rows, "dayforcehcm").current_status, "disabled");
  assert.equal(find(rows, "dayforcehcm").should_be_public_enabled, false);
}

function testHighGapEmbeddedSourceNeedsDetailRefetchAndHoldRecommendation() {
  const rows = buildAtsScoreboard({
    atsItems: [{ value: "theapplicantmanager", label: "The Applicant Manager" }],
    qualitySummary: {
      by_source: [{
        source_ats: "theapplicantmanager",
        total_visible_rows: 5000,
        missing_country_pct: 98,
        missing_city_pct: 100,
        missing_any_normalized_geo_pct: 100,
        weak_unknown_remote_type_pct: 100
      }]
    }
  });
  const row = rows[0];

  assert.equal(row.current_status, "certified");
  assert.equal(detailRefetchNeeded(row), true);
  assert.equal(row.detail_refetch_needed, true);
  assert.equal(publicEnabledRecommendation(row), false);
  assert.equal(row.should_be_public_enabled, false);
  assert.equal(row.wave_priority, "wave-1-live-gap");
  assert.doesNotMatch(row.certification_blockers, /missing strict raw parser fixture/);
  assert.match(row.certification_blockers, /high missing normalized geo/);
  assert.match(row.exact_next_parser_action, /detail-refetch/);
}

function testCertifiedLowGapSourceRemainsPublicEnabled() {
  const rows = buildAtsScoreboard({
    atsItems: [{ value: "lever", label: "Lever" }],
    qualitySummary: {
      by_source: [{
        source_ats: "lever",
        total_visible_rows: 1200,
        missing_country_pct: 4,
        missing_city_pct: 12,
        missing_any_normalized_geo_pct: 12,
        weak_unknown_remote_type_pct: 8
      }]
    }
  });
  const row = rows[0];

  assert.equal(row.current_status, "certified");
  assert.equal(row.should_be_public_enabled, true);
  assert.equal(row.detail_refetch_needed, false);
  assert.equal(wavePriority(row), "monitor");
}

function testSummaryCountsAndRecommendations() {
  const rows = buildAtsScoreboard({
    atsItems: [
      { value: "lever", label: "Lever" },
      { value: "brassring", label: "BrassRing" },
      { value: "dayforcehcm", label: "Dayforce", enabledByDefault: false }
    ],
    qualitySummary: {
      by_source: [{
        source_ats: "brassring",
        total_visible_rows: 100,
        missing_country_pct: 95,
        missing_city_pct: 100,
        missing_any_normalized_geo_pct: 100,
        weak_unknown_remote_type_pct: 100
      }]
    }
  });
  const summary = buildSummary(rows);

  assert.equal(summary.configured_ats_count, 3);
  assert.equal(summary.status_counts.disabled, 1);
  assert.ok(summary.top_15_quality_risk.some((row) => row.ats_key === "brassring"));
  assert.ok(summary.disabled_or_quarantine_recommendations.some((row) => row.ats_key === "dayforcehcm"));
}

function main() {
  testScoreboardIncludesConfiguredAtsWithoutRows();
  testHighGapEmbeddedSourceNeedsDetailRefetchAndHoldRecommendation();
  testCertifiedLowGapSourceRemainsPublicEnabled();
  testSummaryCountsAndRecommendations();
  console.log("audit-ats-quality tests passed");
}

if (require.main === module) {
  main();
}
