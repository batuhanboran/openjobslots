const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildItems,
  buildMarkdown,
  canonicalSourceKey,
  foldProductionRows,
  parseArgs
} = require("./report-disabled-ats-recovery-plan");

test("canonicalSourceKey folds legacy ADP aliases", () => {
  assert.equal(canonicalSourceKey("adpworkforcenow"), "adp_workforcenow");
  assert.equal(canonicalSourceKey("workforcenow.adp.com"), "adp_workforcenow");
});

test("foldProductionRows merges legacy aliases into canonical target state", () => {
  const rows = foldProductionRows([
    {
      raw_ats_key: "adp_workforcenow",
      enabled: "false",
      protection_status: "auto_disabled",
      disabled_reason: "parser_drift",
      visible_rows: 26,
      missing_any_geo: 6
    },
    {
      raw_ats_key: "adpworkforcenow",
      enabled: "true",
      protection_status: "canary_only",
      visible_rows: 0
    }
  ], ["adp_workforcenow"]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].ats_key, "adp_workforcenow");
  assert.equal(rows[0].visible_rows, 26);
  assert.deepEqual(rows[0].legacy_alias_rows, ["adpworkforcenow"]);
  assert.equal(rows[0].protection_status, "auto_disabled");
});

test("buildItems marks local-ready targets as production gated when source protection blocks sync", () => {
  const items = buildItems({
    sources: ["workday", "gem", "personio"],
    productionRows: [
      {
        raw_ats_key: "workday",
        enabled: "false",
        protection_status: "auto_disabled",
        disabled_reason: "http_blocked",
        visible_rows: 0
      },
      {
        raw_ats_key: "gem",
        enabled: "false",
        protection_status: "auto_disabled",
        disabled_reason: "parser_drift",
        visible_rows: 31,
        missing_any_geo: 29,
        weak_remote: 3
      }
    ]
  });

  const workday = items.find((item) => item.ats_key === "workday");
  const gem = items.find((item) => item.ats_key === "gem");
  const personio = items.find((item) => item.ats_key === "personio");

  assert.equal(workday.threshold_state, "production_gated");
  assert.ok(workday.blockers.includes("production protection blocks sync: auto_disabled"));
  assert.equal(gem.threshold_state, "production_gated");
  assert.ok(gem.recommended_actions.some((action) => action.includes("reset source protection")));
  assert.equal(personio.threshold_state, "production_gated");
  assert.ok(personio.blockers.includes("production source row missing"));
});

test("buildMarkdown renders target state table", () => {
  const report = {
    summary: {
      generated_at: "2026-06-05T00:00:00.000Z",
      production_available: true,
      target_count: 1,
      local_ready_count: 1,
      production_gated_count: 1
    },
    items: buildItems({
      sources: ["adp_workforcenow"],
      productionRows: [
        {
          raw_ats_key: "adpworkforcenow",
          enabled: "true",
          protection_status: "canary_only"
        }
      ]
    })
  };
  const markdown = buildMarkdown(report);
  assert.match(markdown, /Disabled ATS Recovery Plan/);
  assert.match(markdown, /\| `adp_workforcenow` \|/);
  assert.match(markdown, /legacy alias rows present/);
});

test("parseArgs keeps default target sources and accepts source overrides", () => {
  assert.equal(parseArgs([]).sources.includes("workday"), true);
  assert.deepEqual(parseArgs(["--sources=adpworkforcenow,personio"]).sources, ["adp_workforcenow", "personio"]);
  assert.equal(parseArgs(["--production-rows-file=target.json"]).productionRowsFile, "target.json");
  assert.equal(parseArgs(["--production-rows-file=-"]).productionRowsFile, "-");
});
