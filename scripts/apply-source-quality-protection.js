#!/usr/bin/env node

const { createPostgresPool, ensurePostgresSchema, getPostgresConfig } = require("../server/backends/postgres");
const {
  applyPostgresSourceQualityProtection,
  getPostgresSourceQualityDashboard
} = require("../server/backends/postgresStore");

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    apply: false,
    confirmProduction: false,
    json: false,
    limit: 250
  };
  for (const arg of argv) {
    if (arg === "--apply") options.apply = true;
    else if (arg === "--confirm-production") options.confirmProduction = true;
    else if (arg === "--json") options.json = true;
    else if (arg.startsWith("--limit=")) {
      const parsed = Number(arg.slice("--limit=".length));
      if (Number.isFinite(parsed)) options.limit = Math.max(1, Math.min(250, Math.floor(parsed)));
    }
  }
  return options;
}

async function main() {
  const options = parseArgs();
  const pool = createPostgresPool(getPostgresConfig());
  if (!pool) throw new Error("source-quality protection requires OPENJOBSLOTS_DB_BACKEND=postgres");
  try {
    await ensurePostgresSchema(pool);
    if (!options.apply) {
      const items = await getPostgresSourceQualityDashboard(pool, options.limit);
      const recommended = items
        .filter((item) => ["disable", "quarantine_only"].includes(String(item.recommended_action || "")))
        .map((item) => ({
          ats_key: item.ats_key,
          current_status: item.protection_status,
          source_quality_state: item.source_quality_state,
          recommended_action: item.recommended_action,
          recommended_reason: item.recommended_reason
        }));
      const result = { ok: true, dry_run: true, recommended_count: recommended.length, recommended };
      console.log(options.json ? JSON.stringify(result, null, 2) : JSON.stringify(result));
      return;
    }

    if (!options.confirmProduction) {
      throw new Error("Refusing source-quality apply without --confirm-production");
    }
    const result = await applyPostgresSourceQualityProtection(pool);
    console.log(options.json ? JSON.stringify(result, null, 2) : JSON.stringify(result));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
