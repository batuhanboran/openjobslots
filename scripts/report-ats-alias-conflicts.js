#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const { createPostgresPool, getPostgresConfig } = require("../server/backends/postgres");
const {
  ALIAS_CANONICALIZATION_TABLES,
  selectActions
} = require("./apply-ats-source-state-repair");

const DEFAULT_PLAN_FILE = path.join("docs", "reference", "ats-source-state-repair-plan.json");
const CONFLICT_TABLE_KEYS = Object.freeze({
  companies: ["url_string"],
  company_sync_state: ["company_url"],
  source_payload_shapes: ["parser_version"]
});

let stdinCache = null;

function clean(value) {
  return String(value || "").trim();
}

function parseCsv(value) {
  return clean(value).split(",").map(clean).filter(Boolean);
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    planFile: DEFAULT_PLAN_FILE,
    output: "",
    sourceFilters: [],
    json: false
  };
  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg.startsWith("--plan-file=")) options.planFile = arg.slice("--plan-file=".length);
    else if (arg.startsWith("--output=")) options.output = arg.slice("--output=".length);
    else if (arg.startsWith("--source=")) options.sourceFilters.push(...parseCsv(arg.slice("--source=".length)));
  }
  return options;
}

function readStdinJson() {
  if (stdinCache === null) stdinCache = fs.readFileSync(0, "utf8");
  return JSON.parse(stdinCache.replace(/^\uFEFF/, ""));
}

function readJson(filePath) {
  if (!filePath) return null;
  if (filePath === "-") return readStdinJson();
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8").replace(/^\uFEFF/, ""));
}

function writeJson(filePath, payload) {
  if (!filePath) return;
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(payload, null, 2)}\n`);
}

function safeTableName(table) {
  const name = clean(table);
  if (!ALIAS_CANONICALIZATION_TABLES.includes(name)) {
    throw new Error(`unsupported alias conflict table: ${name}`);
  }
  return name;
}

function safeColumnName(column) {
  const name = clean(column);
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`unsafe column name: ${name}`);
  return name;
}

function aliasActionsFromPlan(plan = {}, options = {}) {
  return selectActions(plan, {
    sourceFilters: options.sourceFilters || [],
    actionTypes: ["canonicalize_legacy_alias"]
  });
}

async function tableExists(pool, table) {
  const result = await pool.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = $1
      ) AS exists;
    `,
    [safeTableName(table)]
  );
  return result.rows[0]?.exists === true || result.rows[0]?.exists === "t";
}

async function countRows(pool, table, atsKey) {
  const safeTable = safeTableName(table);
  const result = await pool.query(`SELECT COUNT(*)::int AS count FROM ${safeTable} WHERE ats_key = $1;`, [clean(atsKey)]);
  return Number(result.rows[0]?.count || 0);
}

async function conflictCount(pool, table, alias, canonical) {
  const safeTable = safeTableName(table);
  const keys = CONFLICT_TABLE_KEYS[safeTable] || [];
  if (keys.length === 0) return { conflict_count: 0, conflict_keys: [] };
  const keySelect = keys.map((key) => `legacy.${safeColumnName(key)} AS ${safeColumnName(key)}`).join(", ");
  const keyJoin = keys.map((key) => `canonical.${safeColumnName(key)} = legacy.${safeColumnName(key)}`).join(" AND ");
  const result = await pool.query(
    `
      SELECT ${keySelect}
      FROM ${safeTable} legacy
      INNER JOIN ${safeTable} canonical
        ON canonical.ats_key = $2
       AND ${keyJoin}
      WHERE legacy.ats_key = $1
      ORDER BY ${keys.map((key) => `legacy.${safeColumnName(key)}`).join(", ")}
      LIMIT 25;
    `,
    [clean(alias), clean(canonical)]
  );
  return {
    conflict_count: result.rows.length,
    conflict_keys: result.rows.map((row) => {
      const item = {};
      for (const key of keys) item[key] = clean(row[key]);
      return item;
    })
  };
}

async function inspectAliasAction(pool, action = {}) {
  const canonical = clean(action.ats_key);
  const aliases = Array.from(new Set((action.legacy_alias_rows || []).map(clean).filter(Boolean)));
  const tables = (action.tables_to_review || ALIAS_CANONICALIZATION_TABLES).map(safeTableName);
  const tableReports = [];
  for (const table of tables) {
    const exists = await tableExists(pool, table);
    if (!exists) {
      tableReports.push({
        table,
        exists: false,
        legacy_alias_rows: [],
        canonical_rows: 0,
        conflict_count: 0,
        conflict_keys: []
      });
      continue;
    }
    const canonicalRows = await countRows(pool, table, canonical);
    for (const alias of aliases) {
      const legacyRows = await countRows(pool, table, alias);
      const conflicts = await conflictCount(pool, table, alias, canonical);
      tableReports.push({
        table,
        exists: true,
        canonical_ats_key: canonical,
        legacy_alias: alias,
        legacy_rows: legacyRows,
        canonical_rows: canonicalRows,
        conflict_count: conflicts.conflict_count,
        conflict_keys: conflicts.conflict_keys
      });
    }
  }
  const conflictCountTotal = tableReports.reduce((sum, item) => sum + Number(item.conflict_count || 0), 0);
  const legacyRowsTotal = tableReports.reduce((sum, item) => sum + Number(item.legacy_rows || 0), 0);
  return {
    ats_key: canonical,
    legacy_alias_rows: aliases,
    tables_reviewed: tableReports.length,
    legacy_rows_total: legacyRowsTotal,
    conflict_count: conflictCountTotal,
    safe_to_canonicalize_without_merge: conflictCountTotal === 0,
    tables: tableReports
  };
}

async function buildAliasConflictReport({ plan, options, pool }) {
  const actions = aliasActionsFromPlan(plan, options);
  const reports = [];
  for (const action of actions) reports.push(await inspectAliasAction(pool, action));
  const conflictCountTotal = reports.reduce((sum, item) => sum + Number(item.conflict_count || 0), 0);
  const legacyRowsTotal = reports.reduce((sum, item) => sum + Number(item.legacy_rows_total || 0), 0);
  return {
    ok: conflictCountTotal === 0,
    read_only: true,
    generated_at: new Date().toISOString(),
    plan_hash: clean(plan?.plan_hash),
    alias_action_count: actions.length,
    legacy_rows_total: legacyRowsTotal,
    conflict_count: conflictCountTotal,
    safe_to_canonicalize_without_merge: conflictCountTotal === 0,
    reports
  };
}

async function main() {
  const options = parseArgs();
  const plan = readJson(options.planFile);
  const pool = createPostgresPool(getPostgresConfig());
  if (!pool) throw new Error("ats alias conflict report requires OPENJOBSLOTS_DB_BACKEND=postgres");
  try {
    const report = await buildAliasConflictReport({ plan, options, pool });
    writeJson(options.output, report);
    process.stdout.write(options.json || !report.ok ? `${JSON.stringify(report, null, 2)}\n` : "ATS alias conflict report passed\n");
    if (!report.ok) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  CONFLICT_TABLE_KEYS,
  aliasActionsFromPlan,
  buildAliasConflictReport,
  conflictCount,
  inspectAliasAction,
  parseArgs
};
