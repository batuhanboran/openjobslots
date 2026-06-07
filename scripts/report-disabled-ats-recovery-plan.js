#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { createPostgresPool, getPostgresConfig } = require("../server/backends/postgres");
const { getAdapterMetadata, isAtsEnabledByDefault } = require("../server/ingestion/adapter-metadata");
const {
  ATS_FILTER_LABEL_BY_VALUE,
  getAtsFilterAliasValues,
  normalizeAtsFilterValue
} = require("../server/ingestion/atsFilters");
const {
  getRegistrySourceModule,
  resolveRegistrySourceKey
} = require("../server/ingestion/sourceRegistry");
const {
  SOURCE_STATUSES,
  validateSourceRecoveryContract
} = require("../server/ingestion/sourceContracts");

const DEFAULT_TARGET_SOURCES = Object.freeze([
  "workday",
  "manatal",
  "dayforcehcm",
  "gem",
  "adp_workforcenow",
  "personio",
  "workable"
]);

const DEFAULT_MARKDOWN_OUTPUT = path.join("docs", "reference", "ats-disabled-recovery-plan.md");
const DEFAULT_JSON_OUTPUT = path.join("docs", "reference", "ats-disabled-recovery-plan.json");

function clean(value) {
  return String(value || "").trim();
}

function toNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    json: false,
    markdown: false,
    localOnly: false,
    output: "",
    markdownOutput: "",
    productionRowsFile: "",
    sources: [...DEFAULT_TARGET_SOURCES]
  };
  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg === "--markdown") options.markdown = true;
    else if (arg === "--local-only" || arg === "--no-db") options.localOnly = true;
    else if (arg.startsWith("--output=")) options.output = arg.slice("--output=".length);
    else if (arg.startsWith("--markdown-output=")) options.markdownOutput = arg.slice("--markdown-output=".length);
    else if (arg.startsWith("--production-rows-file=")) options.productionRowsFile = arg.slice("--production-rows-file=".length);
    else if (arg.startsWith("--sources=")) {
      options.sources = arg.slice("--sources=".length)
        .split(",")
        .map((item) => clean(item).toLowerCase())
        .filter(Boolean);
    }
  }
  options.sources = Array.from(new Set(options.sources.map(canonicalSourceKey).filter(Boolean)));
  if (options.sources.length === 0) options.sources = [...DEFAULT_TARGET_SOURCES];
  return options;
}

function readProductionRowsFile(filePath) {
  if (!filePath) return [];
  const content = filePath === "-"
    ? fs.readFileSync(0, "utf8")
    : fs.readFileSync(path.resolve(filePath), "utf8");
  const parsed = JSON.parse(content.replace(/^\uFEFF/, "").trim());
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.items)) return parsed.items;
  if (Array.isArray(parsed.rows)) return parsed.rows;
  throw new Error("--production-rows-file must contain an array, items array, or rows array");
}

function canonicalSourceKey(value) {
  const normalized = normalizeAtsFilterValue(value);
  return resolveRegistrySourceKey(normalized) || normalized;
}

function sourceDisplayName(atsKey) {
  return ATS_FILTER_LABEL_BY_VALUE.get(atsKey) || getAdapterMetadata(atsKey).displayName || atsKey;
}

function existingFixturePaths(sourceModule = {}) {
  if (typeof sourceModule.fixtures !== "function") return [];
  try {
    const fixturePaths = sourceModule.fixtures();
    if (!Array.isArray(fixturePaths)) return [];
    return fixturePaths.map((fixturePath) => clean(fixturePath)).filter(Boolean);
  } catch {
    return [];
  }
}

function fixtureFileStatus(sourceModule = {}) {
  const fixturePaths = existingFixturePaths(sourceModule);
  const missing = fixturePaths.filter((fixturePath) => !fs.existsSync(path.resolve(fixturePath)));
  return {
    paths: fixturePaths,
    missing,
    all_present: fixturePaths.length > 0 && missing.length === 0
  };
}

function buildLocalStatus(atsKey) {
  const sourceModule = getRegistrySourceModule(atsKey);
  const recoveryContract = validateSourceRecoveryContract(sourceModule);
  const fixtures = fixtureFileStatus(sourceModule);
  const metadata = getAdapterMetadata(atsKey);
  const modulePresent = sourceModule.status !== SOURCE_STATUSES.unsupported;
  const blockers = [];
  if (!modulePresent) blockers.push("missing source module");
  if (!recoveryContract.ok) blockers.push(...recoveryContract.failures);
  if (!fixtures.all_present) blockers.push(`missing fixture files: ${fixtures.missing.join(", ") || "none declared"}`);

  return {
    ats_key: atsKey,
    display_name: sourceDisplayName(atsKey),
    registry_status: sourceModule.status || "unsupported",
    collect_when_disabled: Boolean(sourceModule.collectWhenDisabled),
    enabled_by_default: isAtsEnabledByDefault(atsKey),
    adapter_tier: metadata.tier,
    parser_fixture_status: metadata.parserFixtureStatus,
    parser_confidence: metadata.confidence,
    source_module_present: modulePresent,
    recovery_contract_ok: recoveryContract.ok,
    fixture_files_all_present: fixtures.all_present,
    fixture_paths: fixtures.paths,
    local_blockers: Array.from(new Set(blockers))
  };
}

function addMetric(target, field, value) {
  target[field] = toNumber(target[field]) + toNumber(value);
}

function foldProductionRows(rows = [], targetSources = DEFAULT_TARGET_SOURCES) {
  const byKey = new Map(targetSources.map((source) => [canonicalSourceKey(source), {
    ats_key: canonicalSourceKey(source),
    source_row_present: false,
    raw_source_rows: [],
    legacy_alias_rows: [],
    enabled: "missing",
    protection_status: "missing",
    disabled_reason: "",
    disabled_at: "",
    visible_rows: 0,
    missing_any_geo: 0,
    weak_remote: 0,
    cache_rows: 0,
    cache_public: 0,
    cache_quarantined: 0,
    last_run_status: "",
    last_run_mode: "",
    last_fetch: 0,
    last_parse: 0,
    last_accepted: 0,
    last_quarantine: 0,
    last_rejected: 0,
    latest_quality_reason: "",
    latest_quality_action: ""
  }]));

  for (const raw of Array.isArray(rows) ? rows : []) {
    const rawKey = clean(raw.raw_ats_key || raw.ats_key).toLowerCase();
    const key = canonicalSourceKey(rawKey);
    if (!key || !byKey.has(key)) continue;
    const folded = byKey.get(key);
    const isCanonicalRow = rawKey === key;
    folded.raw_source_rows.push(rawKey);
    if (!isCanonicalRow) folded.legacy_alias_rows.push(rawKey);
    if (clean(raw.enabled) !== "missing") folded.source_row_present = true;

    if (isCanonicalRow || folded.enabled === "missing") {
      folded.enabled = clean(raw.enabled) || folded.enabled;
      folded.protection_status = clean(raw.protection_status) || folded.protection_status;
      folded.disabled_reason = clean(raw.disabled_reason) || folded.disabled_reason;
      folded.disabled_at = clean(raw.disabled_at) || folded.disabled_at;
    }

    for (const field of [
      "visible_rows",
      "missing_any_geo",
      "weak_remote",
      "cache_rows",
      "cache_public",
      "cache_quarantined"
    ]) {
      addMetric(folded, field, raw[field]);
    }

    const latestRunFields = ["last_fetch", "last_parse", "last_accepted", "last_quarantine", "last_rejected"];
    for (const field of latestRunFields) addMetric(folded, field, raw[field]);
    if (!folded.last_run_status && clean(raw.last_run_status)) folded.last_run_status = clean(raw.last_run_status);
    if (!folded.last_run_mode && clean(raw.last_run_mode)) folded.last_run_mode = clean(raw.last_run_mode);
    if (!folded.latest_quality_reason && clean(raw.latest_quality_reason)) folded.latest_quality_reason = clean(raw.latest_quality_reason);
    if (!folded.latest_quality_action && clean(raw.latest_quality_action)) folded.latest_quality_action = clean(raw.latest_quality_action);
  }

  return Array.from(byKey.values()).map((item) => ({
    ...item,
    raw_source_rows: Array.from(new Set(item.raw_source_rows)),
    legacy_alias_rows: Array.from(new Set(item.legacy_alias_rows))
  }));
}

function productionBlockers(local, production) {
  const blockers = [];
  if (!production.source_row_present) blockers.push("production source row missing");
  if (production.legacy_alias_rows.length > 0) blockers.push(`legacy alias rows present: ${production.legacy_alias_rows.join(", ")}`);
  if (["disabled", "auto_disabled"].includes(production.protection_status)) {
    blockers.push(`production protection blocks sync: ${production.protection_status}`);
  }
  if (local.registry_status === SOURCE_STATUSES.disabled) {
    blockers.push("local registry keeps source disabled until live canary evidence");
  }
  if (!local.enabled_by_default) blockers.push("excluded from default sync");
  return blockers;
}

function recommendedActions(local, production) {
  const actions = [];
  if (local.local_blockers.length > 0) {
    actions.push("fix local source module, recovery contract, and fixture blockers first");
    return actions;
  }
  if (!production.source_row_present) {
    actions.push("deploy/seed local source registry so production creates the disabled source row");
  }
  if (production.legacy_alias_rows.length > 0) {
    actions.push("canonicalize legacy production ATS aliases into the canonical source key before promotion");
  }
  if (["auto_disabled", "disabled"].includes(production.protection_status)) {
    actions.push("after explicit approval, backup, preflight, and worker isolation, reset source protection to a bounded canary state");
  }
  actions.push("run read-only inventory scan, net-new estimate, and tenant batch plan");
  actions.push("run bounded canary/apply only after planned-batch and recovery preflight pass");
  actions.push("finish with recovery guard plus Meili/Postgres parity delta 0 before claiming threshold success");
  return Array.from(new Set(actions));
}

function thresholdState(local, production) {
  if (local.local_blockers.length > 0) return "local_blocked";
  const blockers = productionBlockers(local, production);
  if (blockers.length > 0) return "production_gated";
  if (!["enabled", "canary"].includes(local.registry_status)) return "canary_evidence_required";
  return "ready_for_read_only_inventory";
}

function buildItems({ sources = DEFAULT_TARGET_SOURCES, productionRows = [] } = {}) {
  const canonicalSources = Array.from(new Set(sources.map(canonicalSourceKey).filter(Boolean)));
  const productionBySource = new Map(foldProductionRows(productionRows, canonicalSources).map((item) => [item.ats_key, item]));
  return canonicalSources.map((atsKey) => {
    const local = buildLocalStatus(atsKey);
    const production = productionBySource.get(atsKey);
    const blockers = productionBlockers(local, production);
    return {
      ats_key: atsKey,
      display_name: local.display_name,
      threshold_state: thresholdState(local, production),
      local,
      production,
      blockers,
      recommended_actions: recommendedActions(local, production)
    };
  });
}

function buildSummary(items = [], generatedAt = new Date().toISOString(), productionAvailable = false) {
  const byState = {};
  for (const item of items) byState[item.threshold_state] = (byState[item.threshold_state] || 0) + 1;
  return {
    generated_at: generatedAt,
    production_available: Boolean(productionAvailable),
    target_count: items.length,
    by_threshold_state: byState,
    local_ready_count: items.filter((item) => item.local.local_blockers.length === 0).length,
    production_gated_count: items.filter((item) => item.threshold_state === "production_gated").length
  };
}

function buildMarkdown(report = {}) {
  const lines = [
    "# Disabled ATS Recovery Plan",
    "",
    `Generated: ${report.summary?.generated_at || ""}`,
    "",
    "This report is read-only. It combines local source-module readiness with production source state so disabled sources are not mistaken for recovered sources before canary/apply and Meili/Postgres parity proof.",
    "",
    "## Summary",
    "",
    `- Production data available: ${report.summary?.production_available ? "yes" : "no"}`,
    `- Target count: ${report.summary?.target_count || 0}`,
    `- Local ready count: ${report.summary?.local_ready_count || 0}`,
    `- Production gated count: ${report.summary?.production_gated_count || 0}`,
    "",
    "## Targets",
    "",
    "| ats | state | local registry | production status | visible rows | blocker | next action |",
    "| --- | --- | --- | --- | ---: | --- | --- |"
  ];
  for (const item of report.items || []) {
    const blocker = item.blockers[0] || item.local.local_blockers[0] || "";
    const action = item.recommended_actions[0] || "";
    lines.push([
      `| \`${item.ats_key}\``,
      item.threshold_state,
      item.local.registry_status,
      `${item.production.enabled}/${item.production.protection_status}`,
      item.production.visible_rows,
      blocker.replace(/\|/g, "/"),
      `${action.replace(/\|/g, "/")} |`
    ].join(" | "));
  }
  return `${lines.join("\n")}\n`;
}

async function loadProductionRows(pool, sources = DEFAULT_TARGET_SOURCES) {
  const aliases = Array.from(new Set(sources.flatMap((source) => getAtsFilterAliasValues(source)).map(clean).filter(Boolean)));
  const result = await pool.query(`
    WITH target_sources AS (
      SELECT unnest($1::text[]) AS ats_key
    ), latest_events AS (
      SELECT DISTINCT ON (ats_key) ats_key,event_type,severity,reason,action,metrics,created_at
      FROM source_quality_events
      WHERE ats_key IN (SELECT ats_key FROM target_sources)
      ORDER BY ats_key, created_at DESC
    ), latest_runs AS (
      SELECT DISTINCT ON (ats_key) ats_key,status,mode,fetch_count,parse_count,accepted_count,quarantined_count,rejected_count,started_at,finished_at
      FROM ats_source_runs
      WHERE ats_key IN (SELECT ats_key FROM target_sources)
      ORDER BY ats_key, COALESCE(finished_at,started_at,created_at) DESC
    ), cache AS (
      SELECT ats_key,
        COUNT(*)::bigint AS cache_rows,
        COUNT(*) FILTER (WHERE validation_status='quarantine')::bigint AS cache_quarantined,
        COUNT(*) FILTER (WHERE validation_status='public')::bigint AS cache_public
      FROM posting_cache
      WHERE ats_key IN (SELECT ats_key FROM target_sources)
      GROUP BY ats_key
    ), visible AS (
      SELECT ats_key,
        COUNT(*) FILTER (WHERE hidden IS NOT TRUE)::bigint AS visible_rows,
        COUNT(*) FILTER (WHERE hidden IS NOT TRUE AND (
          NULLIF(country,'') IS NULL OR NULLIF(region,'') IS NULL OR NULLIF(city,'') IS NULL
        ))::bigint AS missing_any_geo,
        COUNT(*) FILTER (WHERE hidden IS NOT TRUE AND COALESCE(remote_type,'') IN ('','unknown'))::bigint AS weak_remote
      FROM postings
      WHERE ats_key IN (SELECT ats_key FROM target_sources)
      GROUP BY ats_key
    )
    SELECT t.ats_key AS raw_ats_key,
      COALESCE(s.enabled::text,'missing') AS enabled,
      COALESCE(s.protection_status,'missing') AS protection_status,
      COALESCE(s.disabled_reason,'') AS disabled_reason,
      COALESCE(to_char(s.disabled_at,'YYYY-MM-DD HH24:MI:SS'),'') AS disabled_at,
      COALESCE(v.visible_rows,0)::bigint AS visible_rows,
      COALESCE(v.missing_any_geo,0)::bigint AS missing_any_geo,
      COALESCE(v.weak_remote,0)::bigint AS weak_remote,
      COALESCE(c.cache_rows,0)::bigint AS cache_rows,
      COALESCE(c.cache_public,0)::bigint AS cache_public,
      COALESCE(c.cache_quarantined,0)::bigint AS cache_quarantined,
      COALESCE(lr.status,'') AS last_run_status,
      COALESCE(lr.mode,'') AS last_run_mode,
      COALESCE(lr.fetch_count,0)::bigint AS last_fetch,
      COALESCE(lr.parse_count,0)::bigint AS last_parse,
      COALESCE(lr.accepted_count,0)::bigint AS last_accepted,
      COALESCE(lr.quarantined_count,0)::bigint AS last_quarantine,
      COALESCE(lr.rejected_count,0)::bigint AS last_rejected,
      COALESCE(le.reason,'') AS latest_quality_reason,
      COALESCE(le.action,'') AS latest_quality_action
    FROM target_sources t
    LEFT JOIN ats_sources s ON s.ats_key=t.ats_key
    LEFT JOIN visible v ON v.ats_key=t.ats_key
    LEFT JOIN cache c ON c.ats_key=t.ats_key
    LEFT JOIN latest_runs lr ON lr.ats_key=t.ats_key
    LEFT JOIN latest_events le ON le.ats_key=t.ats_key
    ORDER BY t.ats_key;
  `, [aliases]);
  return result.rows;
}

function writeFile(filePath, content) {
  if (!filePath) return;
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, content);
}

async function main() {
  const options = parseArgs();
  let productionRows = [];
  let productionAvailable = false;
  let pool = null;
  try {
    if (options.productionRowsFile) {
      productionRows = readProductionRowsFile(options.productionRowsFile);
      productionAvailable = true;
    } else if (!options.localOnly) {
      pool = createPostgresPool(getPostgresConfig());
      if (pool) {
        productionRows = await loadProductionRows(pool, options.sources);
        productionAvailable = true;
      }
    }
    const generatedAt = new Date().toISOString();
    const items = buildItems({ sources: options.sources, productionRows });
    const report = {
      ok: true,
      read_only: true,
      summary: buildSummary(items, generatedAt, productionAvailable),
      items
    };
    if (options.output) writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
    if (options.markdownOutput) writeFile(options.markdownOutput, buildMarkdown(report));
    if (!options.output && !options.markdownOutput && (options.markdown || options.json)) {
      if (options.markdown) process.stdout.write(buildMarkdown(report));
      else process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else if (!options.output && !options.markdownOutput) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    }
  } finally {
    if (pool) await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_TARGET_SOURCES,
  buildItems,
  buildLocalStatus,
  buildMarkdown,
  buildSummary,
  canonicalSourceKey,
  foldProductionRows,
  loadProductionRows,
  parseArgs,
  recommendedActions,
  thresholdState
};
