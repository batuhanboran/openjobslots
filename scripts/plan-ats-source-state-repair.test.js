const assert = require("node:assert/strict");
const test = require("node:test");

const { buildItems } = require("./report-disabled-ats-recovery-plan");
const {
  buildMarkdown,
  buildRepairPlan,
  parseArgs
} = require("./plan-ats-source-state-repair");

function sampleRecoveryPlan() {
  return {
    summary: {
      generated_at: "2026-06-05T00:00:00.000Z",
      production_available: true
    },
    items: buildItems({
      sources: ["workday", "dayforcehcm", "adp_workforcenow", "personio"],
      productionRows: [
        {
          raw_ats_key: "workday",
          enabled: "false",
          protection_status: "auto_disabled",
          disabled_reason: "http_blocked",
          visible_rows: 0
        },
        {
          raw_ats_key: "dayforcehcm",
          enabled: "false",
          protection_status: "canary_only",
          visible_rows: 0
        },
        {
          raw_ats_key: "adp_workforcenow",
          enabled: "false",
          protection_status: "auto_disabled",
          disabled_reason: "parser_drift",
          visible_rows: 26
        },
        {
          raw_ats_key: "adpworkforcenow",
          enabled: "true",
          protection_status: "canary_only"
        }
      ]
    })
  };
}

test("buildRepairPlan separates seed, protection reset, alias, and canary proof actions", () => {
  const plan = buildRepairPlan(sampleRecoveryPlan());
  const byKey = new Map(plan.targets.map((item) => [item.ats_key, item]));

  assert.equal(plan.read_only, true);
  assert.equal(plan.summary.seed_source_row_count, 1);
  assert.equal(plan.summary.reset_protection_count, 2);
  assert.equal(plan.summary.alias_canonicalization_count, 1);
  assert.ok(plan.required_write_gates.includes("fresh non-empty Postgres backup under backups/"));

  assert.equal(byKey.get("workday").actions[0].type, "reset_source_protection_to_canary");
  assert.match(byKey.get("workday").actions[0].sql_preview.join("\n"), /protection_status = 'canary_only'/);

  const dayforceActions = byKey.get("dayforcehcm").actions.map((action) => action.type);
  assert.deepEqual(dayforceActions, [
    "keep_canary_excluded_from_default_sync",
    "prove_inventory_and_batch_quality"
  ]);
  assert.match(byKey.get("dayforcehcm").actions[0].next_commands.at(-1), /--include-disabled/);

  const adpActions = byKey.get("adp_workforcenow").actions.map((action) => action.type);
  assert.deepEqual(adpActions, [
    "canonicalize_legacy_alias",
    "reset_source_protection_to_canary",
    "prove_inventory_and_batch_quality"
  ]);
  const adpAlias = byKey.get("adp_workforcenow").actions[0];
  assert.ok(adpAlias.tables_to_review.includes("source_quality_events"));
  assert.ok(adpAlias.tables_to_review.includes("ats_source_runs"));
  assert.match(adpAlias.sql_preview.join("\n"), /UPDATE source_quality_events SET ats_key = 'adp_workforcenow'/);

  const personioActions = byKey.get("personio").actions.map((action) => action.type);
  assert.deepEqual(personioActions, [
    "seed_source_row",
    "keep_canary_excluded_from_default_sync",
    "prove_inventory_and_batch_quality"
  ]);
  assert.match(byKey.get("personio").actions[1].next_commands.at(-1), /--include-disabled/);
});

test("buildMarkdown renders source-state repair summary", () => {
  const markdown = buildMarkdown(buildRepairPlan(sampleRecoveryPlan()));
  assert.match(markdown, /ATS Source State Repair Plan/);
  assert.match(markdown, /Source rows to seed: 1/);
  assert.match(markdown, /\| `adp_workforcenow` \|/);
});

test("parseArgs accepts recovery plan and output files", () => {
  const args = parseArgs([
    "--json",
    "--recovery-plan-file=foo.json",
    "--output=out.json",
    "--markdown-output=out.md"
  ]);
  assert.equal(args.json, true);
  assert.equal(args.recoveryPlanFile, "foo.json");
  assert.equal(args.output, "out.json");
  assert.equal(args.markdownOutput, "out.md");
});
