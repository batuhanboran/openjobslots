#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { buildItems } = require("./report-disabled-ats-recovery-plan");

const DEFAULT_RECOVERY_PLAN_FILE = path.join("docs", "reference", "ats-disabled-recovery-plan.json");
const DEFAULT_JSON_OUTPUT = path.join("docs", "reference", "ats-source-state-repair-plan.json");
const DEFAULT_MARKDOWN_OUTPUT = path.join("docs", "reference", "ats-source-state-repair-plan.md");

const REQUIRED_WRITE_GATES = Object.freeze([
  "explicit user approval for production writes",
  "production deploy or expected commit alignment verified",
  "fresh non-empty Postgres backup under backups/",
  "worker isolated or paused",
  "fresh passing ats:recovery:preflight report",
  "planned tenant batch report for any source canary/apply",
  "bounded canary before apply",
  "recovery guard pass",
  "Meili/Postgres parity delta 0"
]);

const ALIAS_CANONICALIZATION_TABLES = Object.freeze([
  "companies",
  "company_sync_state",
  "posting_cache",
  "postings",
  "ingestion_run_errors",
  "source_quality_events",
  "source_payload_shapes",
  "parser_drift_events",
  "ats_source_runs",
  "ats_source_run_errors",
  "ats_source_run_metrics",
  "ats_source_run_rollbacks",
  "ats_source_run_posting_changes"
]);

function clean(value) {
  return String(value || "").trim();
}

function sqlString(value) {
  return `'${clean(value).replace(/'/g, "''")}'`;
}

function sqlBoolean(value) {
  return value ? "true" : "false";
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function planHash(actions = []) {
  return crypto.createHash("sha256").update(stableJson(actions)).digest("hex").slice(0, 16);
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    json: false,
    markdown: false,
    recoveryPlanFile: DEFAULT_RECOVERY_PLAN_FILE,
    output: "",
    markdownOutput: ""
  };
  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg === "--markdown") options.markdown = true;
    else if (arg.startsWith("--recovery-plan-file=")) options.recoveryPlanFile = arg.slice("--recovery-plan-file=".length);
    else if (arg.startsWith("--output=")) options.output = arg.slice("--output=".length);
    else if (arg.startsWith("--markdown-output=")) options.markdownOutput = arg.slice("--markdown-output=".length);
  }
  return options;
}

function readJson(filePath) {
  const content = fs.readFileSync(path.resolve(filePath), "utf8").replace(/^\uFEFF/, "").trim();
  return JSON.parse(content);
}

function writeFile(filePath, content) {
  if (!filePath) return;
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, content);
}

function desiredCanaryState(item = {}) {
  return {
    enabled: item.local?.enabled_by_default === true,
    protection_status: "canary_only",
    disabled_reason: "pending bounded canary proof",
    disabled_at: null
  };
}

function seedSourceRowAction(item = {}) {
  const desired = desiredCanaryState(item);
  const atsKey = clean(item.ats_key);
  const displayName = clean(item.display_name || atsKey);
  return {
    type: "seed_source_row",
    ats_key: atsKey,
    display_name: displayName,
    status: "approval_gated",
    reason: "production ats_sources row is missing",
    desired_state: desired,
    sql_preview: [
      `INSERT INTO ats_sources (ats_key, display_name, enabled, protection_status, disabled_reason, disabled_at, updated_at)`,
      `VALUES (${sqlString(atsKey)}, ${sqlString(displayName)}, ${sqlBoolean(desired.enabled)}, ${sqlString(desired.protection_status)}, ${sqlString(desired.disabled_reason)}, NULL, now())`,
      `ON CONFLICT (ats_key) DO NOTHING;`
    ],
    rollback_preview: [
      `DELETE FROM ats_sources`,
      `WHERE ats_key = ${sqlString(atsKey)}`,
      `  AND NOT EXISTS (SELECT 1 FROM companies WHERE ats_key = ${sqlString(atsKey)})`,
      `  AND NOT EXISTS (SELECT 1 FROM postings WHERE ats_key = ${sqlString(atsKey)});`
    ]
  };
}

function resetProtectionAction(item = {}) {
  const desired = desiredCanaryState(item);
  const atsKey = clean(item.ats_key);
  const currentStatus = clean(item.production?.protection_status || "missing");
  return {
    type: "reset_source_protection_to_canary",
    ats_key: atsKey,
    status: "approval_gated",
    reason: `production protection blocks sync: ${currentStatus}`,
    current_state: {
      enabled: clean(item.production?.enabled || "missing"),
      protection_status: currentStatus,
      disabled_reason: clean(item.production?.disabled_reason || "")
    },
    desired_state: desired,
    sql_preview: [
      `UPDATE ats_sources`,
      `SET enabled = ${sqlBoolean(desired.enabled)},`,
      `    protection_status = ${sqlString(desired.protection_status)},`,
      `    disabled_reason = ${sqlString(desired.disabled_reason)},`,
      `    disabled_at = NULL,`,
      `    updated_at = now()`,
      `WHERE ats_key = ${sqlString(atsKey)}`,
      `  AND COALESCE(NULLIF(protection_status, ''), 'normal') IN ('disabled', 'auto_disabled');`
    ],
    rollback_preview: [
      `UPDATE ats_sources`,
      `SET enabled = ${sqlString(item.production?.enabled) === "'true'" ? "true" : "false"},`,
      `    protection_status = ${sqlString(currentStatus)},`,
      `    disabled_reason = ${sqlString(item.production?.disabled_reason)},`,
      `    disabled_at = NULL,`,
      `    updated_at = now()`,
      `WHERE ats_key = ${sqlString(atsKey)};`
    ]
  };
}

function aliasAction(item = {}) {
  const atsKey = clean(item.ats_key);
  const aliases = Array.from(new Set((item.production?.legacy_alias_rows || []).map(clean).filter(Boolean)));
  return {
    type: "canonicalize_legacy_alias",
    ats_key: atsKey,
    status: "manual_conflict_review_required",
    reason: `legacy alias rows present: ${aliases.join(", ")}`,
    legacy_alias_rows: aliases,
    tables_to_review: [...ALIAS_CANONICALIZATION_TABLES],
    conflict_check_sql: aliases.flatMap((alias) => ALIAS_CANONICALIZATION_TABLES.map((table) =>
      `SELECT ${sqlString(table)} AS table_name, ${sqlString(alias)} AS legacy_alias, count(*) AS rows FROM ${table} WHERE ats_key = ${sqlString(alias)};`
    )),
    sql_preview: aliases.flatMap((alias) => [
      `-- Run only after conflict_check_sql proves no unique-key conflict or a merge plan exists.`,
      ...ALIAS_CANONICALIZATION_TABLES.map((table) =>
        `UPDATE ${table} SET ats_key = ${sqlString(atsKey)} WHERE ats_key = ${sqlString(alias)};`
      ),
      `DELETE FROM ats_sources WHERE ats_key = ${sqlString(alias)};`
    ]),
    rollback_preview: [
      "No automatic rollback preview is safe for alias canonicalization after row merges.",
      "Use the mandatory Postgres backup if alias migration has to be reverted."
    ]
  };
}

function canaryOnlyAction(item = {}) {
  return {
    type: "keep_canary_excluded_from_default_sync",
    ats_key: clean(item.ats_key),
    status: "read_only_next_step",
    reason: "source is intentionally excluded from default sync until live canary proof exists",
    next_commands: nextCommands(item)
  };
}

function inventoryAction(item = {}) {
  return {
    type: "prove_inventory_and_batch_quality",
    ats_key: clean(item.ats_key),
    status: "read_only_next_step",
    reason: "source state repair alone is not threshold success",
    next_commands: nextCommands(item)
  };
}

function nextCommands(itemOrAtsKey) {
  const item = typeof itemOrAtsKey === "object" && itemOrAtsKey !== null ? itemOrAtsKey : { ats_key: itemOrAtsKey };
  const source = clean(item.ats_key);
  const includeDisabled = item.local?.enabled_by_default === false ? " --include-disabled" : "";
  return [
    `npm.cmd run ats:inventory:scan -- --source=${source} --company-limit=<safe_limit> --row-limit=<safe_row_limit> --json --output=<inventory_report>`,
    `npm.cmd run ats:estimate-net-new -- --source=${source} --limit=<safe_limit> --company-limit=<safe_company_limit> --json`,
    `npm.cmd run ats:plan-batches -- --source=${source} --target-gain=<gain> --company-limit=<safe_limit> --row-limit=<safe_row_limit> --json --output=<planned_batch_report>`,
    `npm.cmd run ats:source:canary -- --source=${source}${includeDisabled} --limit=<safe_limit> --confirm-production --backup-confirmed --worker-isolated --planned-batch=<planned_batch_report> --preflight-report=<fresh_preflight_report> --predicted-guard-result=pass --json --output=<source_report>`
  ];
}

function actionsForItem(item = {}) {
  const actions = [];
  if ((item.local?.local_blockers || []).length > 0) {
    actions.push({
      type: "fix_local_source_contract",
      ats_key: clean(item.ats_key),
      status: "local_blocked",
      reason: (item.local.local_blockers || []).join("; ")
    });
    return actions;
  }

  if ((item.production?.legacy_alias_rows || []).length > 0) actions.push(aliasAction(item));
  if (item.production?.source_row_present === false) actions.push(seedSourceRowAction(item));
  if (["disabled", "auto_disabled"].includes(clean(item.production?.protection_status))) {
    actions.push(resetProtectionAction(item));
  }
  if (item.local?.enabled_by_default === false) actions.push(canaryOnlyAction(item));
  actions.push(inventoryAction(item));
  return actions;
}

function normalizeReport(input = {}) {
  if (Array.isArray(input.items)) return input;
  if (Array.isArray(input)) {
    return {
      summary: { generated_at: new Date().toISOString(), production_available: true },
      items: buildItems({ productionRows: input })
    };
  }
  throw new Error("recovery plan must contain an items array or be a production-row array");
}

function buildRepairPlan(recoveryPlan = {}) {
  const report = normalizeReport(recoveryPlan);
  const generatedAt = new Date().toISOString();
  const targetPlans = (report.items || []).map((item) => ({
    ats_key: clean(item.ats_key),
    threshold_state: clean(item.threshold_state),
    production_gated: clean(item.threshold_state) === "production_gated",
    local_registry_status: clean(item.local?.registry_status),
    production_state: {
      source_row_present: item.production?.source_row_present === true,
      enabled: clean(item.production?.enabled || "missing"),
      protection_status: clean(item.production?.protection_status || "missing"),
      legacy_alias_rows: item.production?.legacy_alias_rows || []
    },
    actions: actionsForItem(item)
  }));
  const actions = targetPlans.flatMap((item) => item.actions);
  const hash = planHash(actions);
  return {
    ok: true,
    read_only: true,
    generated_at: generatedAt,
    source_recovery_plan_generated_at: report.summary?.generated_at || "",
    plan_hash: hash,
    summary: {
      target_count: targetPlans.length,
      action_count: actions.length,
      approval_gated_action_count: actions.filter((action) => action.status === "approval_gated" || action.status === "manual_conflict_review_required").length,
      seed_source_row_count: actions.filter((action) => action.type === "seed_source_row").length,
      reset_protection_count: actions.filter((action) => action.type === "reset_source_protection_to_canary").length,
      alias_canonicalization_count: actions.filter((action) => action.type === "canonicalize_legacy_alias").length,
      read_only_next_step_count: actions.filter((action) => action.status === "read_only_next_step").length
    },
    required_write_gates: REQUIRED_WRITE_GATES,
    targets: targetPlans
  };
}

function buildMarkdown(plan = {}) {
  const lines = [
    "# ATS Source State Repair Plan",
    "",
    `Generated: ${plan.generated_at || ""}`,
    `Plan hash: ${plan.plan_hash || ""}`,
    "",
    "This report is read-only. SQL blocks are previews for an approval-gated production run after backup, preflight, worker isolation, bounded canary, recovery guard, and Meili/Postgres parity proof.",
    "",
    "## Summary",
    "",
    `- Target count: ${plan.summary?.target_count || 0}`,
    `- Approval-gated actions: ${plan.summary?.approval_gated_action_count || 0}`,
    `- Source rows to seed: ${plan.summary?.seed_source_row_count || 0}`,
    `- Source protections to reset: ${plan.summary?.reset_protection_count || 0}`,
    `- Alias canonicalizations: ${plan.summary?.alias_canonicalization_count || 0}`,
    "",
    "## Gates",
    ""
  ];
  for (const gate of plan.required_write_gates || []) lines.push(`- ${gate}`);
  lines.push("", "## Targets", "");
  lines.push("| ats | production state | actions |");
  lines.push("| --- | --- | --- |");
  for (const target of plan.targets || []) {
    const state = `${target.production_state.enabled}/${target.production_state.protection_status}`;
    const actions = target.actions.map((action) => action.type).join(", ");
    lines.push(`| \`${target.ats_key}\` | ${state} | ${actions.replace(/\|/g, "/")} |`);
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const options = parseArgs();
  const recoveryPlan = readJson(options.recoveryPlanFile);
  const plan = buildRepairPlan(recoveryPlan);
  if (options.output) writeFile(options.output, `${JSON.stringify(plan, null, 2)}\n`);
  if (options.markdownOutput) writeFile(options.markdownOutput, buildMarkdown(plan));
  if (!options.output && !options.markdownOutput && options.markdown) process.stdout.write(buildMarkdown(plan));
  else if (!options.output && !options.markdownOutput) process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  }
}

module.exports = {
  REQUIRED_WRITE_GATES,
  actionsForItem,
  buildMarkdown,
  buildRepairPlan,
  desiredCanaryState,
  parseArgs
};
