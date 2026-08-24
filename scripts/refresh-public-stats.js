const { createPostgresPool } = require("../server/backends/postgres");
const { refreshPostgresPublicStatsSnapshot } = require("../server/backends/postgresStore");

async function runPublicStatsRefresh(pool, refresh = refreshPostgresPublicStatsSnapshot) {
  if (!pool) throw new Error("OPENJOBSLOTS_DB_BACKEND=postgres is required");
  const counts = await refresh(pool);
  return {
    ok: true,
    refreshed_at: new Date().toISOString(),
    counts
  };
}

async function main() {
  const pool = createPostgresPool();
  try {
    console.log(JSON.stringify(await runPublicStatsRefresh(pool)));
  } finally {
    if (pool) await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { runPublicStatsRefresh };
