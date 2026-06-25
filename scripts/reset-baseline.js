#!/usr/bin/env node

const { Pool } = require("pg");

const atsKey = process.argv[2];
if (!atsKey) {
  console.error("Usage: node scripts/reset-baseline.js <ats_key>");
  process.exit(1);
}

const dbBackend = (process.env.OPENJOBSLOTS_DB_BACKEND || "postgres").trim().toLowerCase();
if (dbBackend !== "postgres") {
  console.error(`Error: Resetting baselines is only supported for postgres backend. Current backend: ${dbBackend}`);
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!connectionString) {
  console.error("Error: DATABASE_URL environment variable is not defined.");
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  connectionTimeoutMillis: 5000,
});

async function main() {
  const normalizedKey = atsKey.trim().toLowerCase();
  console.log(`Resetting payload shape baseline for ATS: '${normalizedKey}'...`);
  
  try {
    const result = await pool.query(
      "DELETE FROM source_payload_shapes WHERE ats_key = $1",
      [normalizedKey]
    );
    console.log(`Success: Deleted ${result.rowCount} baseline row(s) for '${normalizedKey}'.`);
    console.log("The ingestion worker will automatically bootstrap the new payload shape as the baseline on its next run.");
  } catch (error) {
    console.error("Database query failed:", error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
